// Coda delle spunte della lista della spesa. Importabile dai componenti "use client".
// Tiene solo l'ultimo stato voluto per articolo, manda una richiesta alla volta per articolo
// e ritenta da sola finché il server risponde.

import { z } from 'zod';
import { ApiRequestError } from '@/lib/http/client';

export const CHECK_RETRY_FIRST_DELAY_MS = 2_000;
export const CHECK_RETRY_MAX_DELAY_MS = 30_000;
export const CHECK_SEND_TIMEOUT_MS = 10_000;

const STORAGE_PREFIX = 'mealy:shopping:pending:';
const PendingSchema = z.record(z.guid(), z.boolean());

const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;

export interface CheckQueueStorage {
  load(): Record<string, boolean>;
  save(pending: Record<string, boolean>): void;
}

export interface CheckQueueState {
  /** Stati voluti non ancora confermati dal server: id articolo → spuntato. */
  pending: ReadonlyMap<string, boolean>;
  /** true dopo un invio fallito per la rete, finché un invio riesce o la coda si svuota. */
  stalled: boolean;
}

export interface CheckQueueOptions {
  /** Manda lo stato al server; rigetta con ApiRequestError. `signal` si interrompe allo scadere del limite di tempo o al dispose. */
  send: (itemId: string, checked: boolean, signal: AbortSignal) => Promise<void>;
  storage: CheckQueueStorage;
  /** Dopo ogni cambiamento di `pending` o di `stalled`. */
  onChange?: (state: CheckQueueState) => void;
  /** Errore definitivo: la spunta è stata tolta dalla coda senza essere applicata. */
  onDropped?: (itemId: string, error: unknown) => void;
}

export type CheckSendOutcome = 'done' | 'retry' | 'drop';

/** Come trattare un invio fallito. */
export function classifyCheckError(err: unknown): CheckSendOutcome {
  if (!(err instanceof ApiRequestError)) return 'retry';
  const { status } = err;
  // Risposta 2xx non leggibile: il server ha comunque applicato la spunta.
  if (status >= 200 && status < 300) return 'done';
  if (
    status === 0 ||
    status === HTTP_REQUEST_TIMEOUT ||
    status === HTTP_TOO_MANY_REQUESTS ||
    status >= 500
  ) {
    return 'retry';
  }
  return 'drop';
}

/** Coda salvata in localStorage, una chiave per piano. Non lancia mai. */
export function createLocalCheckStorage(planId: string): CheckQueueStorage {
  const key = `${STORAGE_PREFIX}${planId}`;
  return {
    load() {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) return {};
        const parsed = PendingSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : {};
      } catch {
        return {};
      }
    },
    save(pending) {
      try {
        if (Object.keys(pending).length === 0) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(pending));
      } catch {
        // Storage non disponibile (es. navigazione privata): la coda resta in memoria.
      }
    },
  };
}

/** Storage in memoria (test e ambienti senza localStorage). */
export function createMemoryCheckStorage(initial: Record<string, boolean> = {}): CheckQueueStorage {
  let current = { ...initial };
  return {
    load: () => ({ ...current }),
    save: (pending) => {
      current = { ...pending };
    },
  };
}

export class CheckQueue {
  private readonly desired = new Map<string, boolean>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly controllers = new Set<AbortController>();
  private stalled = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly options: CheckQueueOptions) {
    for (const [itemId, checked] of Object.entries(options.storage.load())) {
      this.desired.set(itemId, checked);
    }
  }

  get state(): CheckQueueState {
    return { pending: new Map(this.desired), stalled: this.stalled };
  }

  /** Registra lo stato voluto e prova subito a mandarlo. */
  enqueue(itemId: string, checked: boolean): void {
    if (this.disposed) return;
    this.desired.set(itemId, checked);
    this.persist();
    this.notify();
    void this.pump(itemId);
  }

  /** Prova a mandare ora tutto ciò che è in coda; si risolve quando gli invii in corso sono finiti. */
  async flush(): Promise<void> {
    this.clearTimer();
    await Promise.all([...this.desired.keys()].map((itemId) => this.pump(itemId)));
  }

  /** Ferma i ritentativi (smontaggio del componente) e interrompe gli invii in corso. */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }

  private pump(itemId: string): Promise<void> {
    const running = this.inFlight.get(itemId);
    if (running) return running;
    if (this.disposed || !this.desired.has(itemId)) return Promise.resolve();
    const run = this.sendLatest(itemId);
    this.inFlight.set(itemId, run);
    return run;
  }

  /** Manda lo stato voluto e ripete finché quello mandato è ancora quello voluto. */
  private async sendLatest(itemId: string): Promise<void> {
    try {
      for (;;) {
        const value = this.desired.get(itemId);
        if (value === undefined) return;
        let outcome: CheckSendOutcome = 'done';
        let error: unknown;
        const controller = new AbortController();
        this.controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), CHECK_SEND_TIMEOUT_MS);
        try {
          await this.options.send(itemId, value, controller.signal);
        } catch (err) {
          error = err;
          outcome = classifyCheckError(err);
        } finally {
          clearTimeout(timeout);
          this.controllers.delete(controller);
        }
        if (this.disposed) return;
        if (outcome === 'retry') {
          this.stalled = true;
          this.notify();
          this.scheduleRetry();
          return;
        }
        if (outcome === 'drop') {
          this.desired.delete(itemId);
          this.settle();
          this.options.onDropped?.(itemId, error);
          return;
        }
        this.attempt = 0;
        const finished = this.desired.get(itemId) === value;
        if (finished) this.desired.delete(itemId);
        // Un invio riuscito prova che la rete c'è: le spunte ferme non aspettano il loro timer.
        // `stalled` resta com'è: lo decide l'esito del ritentativo.
        const retryWaiting = this.timer !== null && this.desired.size > 0;
        if (!retryWaiting) this.stalled = false;
        if (finished) this.settle();
        // Altrimenti l'utente ha toccato di nuovo: si manda il valore più recente.
        else this.notify();
        if (retryWaiting) void this.flush();
        if (finished) return;
      }
    } finally {
      this.inFlight.delete(itemId);
    }
  }

  private settle(): void {
    if (this.desired.size === 0) this.stalled = false;
    this.persist();
    this.notify();
  }

  private scheduleRetry(): void {
    if (this.timer !== null || this.disposed) return;
    this.attempt += 1;
    const delay = Math.min(
      CHECK_RETRY_FIRST_DELAY_MS * 2 ** (this.attempt - 1),
      CHECK_RETRY_MAX_DELAY_MS
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private persist(): void {
    this.options.storage.save(Object.fromEntries(this.desired));
  }

  private notify(): void {
    this.options.onChange?.(this.state);
  }
}
