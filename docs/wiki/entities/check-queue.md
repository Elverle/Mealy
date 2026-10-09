---
title: Coda delle Spunte — CheckQueue, Ritentativi e Salvataggio nel Browser (check-queue)
type: entity
created: 2026-10-09
updated: 2026-10-09
tags: [shopping-list, check-queue, offline, retry, backoff, timeout, abort-controller, local-storage, client, feature-6]
---

## File e Responsabilità

- **Percorso file**: `lib/shopping/check-queue.ts` (importabile dai componenti `"use client"`; nessuna dipendenza da React né dal DB)
- **Scopo**: far reggere le spunte della lista a una rete assente o lenta (decisione U2, `DESIGN §1` e §6: al supermercato la rete è pessima). La spunta resta a schermo e la coda la manda al server quando può, da sola.
- È una classe senza React (requirements P13), quindi si prova con timer finti. La istanzia [[shopping-screen]], una per piano mostrato.
- **Cosa passa dalla coda**: solo le spunte, l'unico gesto fatto tra gli scaffali. Aggiunta e rimozione di articoli a mano e *Aggiorna lista* sono richieste dirette (requirements P12).

## Interfaccia

```ts
export const CHECK_RETRY_FIRST_DELAY_MS = 2_000;
export const CHECK_RETRY_MAX_DELAY_MS = 30_000;
export const CHECK_SEND_TIMEOUT_MS = 10_000;

export interface CheckQueueStorage {
  load(): Record<string, boolean>;
  save(pending: Record<string, boolean>): void;
}

export interface CheckQueueState {
  pending: ReadonlyMap<string, boolean>;  // id articolo → stato voluto, non ancora confermato dal server
  stalled: boolean;                       // true dopo un invio fallito per la rete
}

export interface CheckQueueOptions {
  send: (itemId: string, checked: boolean, signal: AbortSignal) => Promise<void>;
  storage: CheckQueueStorage;
  onChange?: (state: CheckQueueState) => void;            // dopo ogni cambiamento di pending o stalled
  onDropped?: (itemId: string, error: unknown) => void;   // errore definitivo: spunta tolta dalla coda
}

export type CheckSendOutcome = 'done' | 'retry' | 'drop';
export function classifyCheckError(err: unknown): CheckSendOutcome;
export function createLocalCheckStorage(planId: string): CheckQueueStorage;
export function createMemoryCheckStorage(initial?: Record<string, boolean>): CheckQueueStorage;

export class CheckQueue {
  constructor(options: CheckQueueOptions);
  get state(): CheckQueueState;
  enqueue(itemId: string, checked: boolean): void;
  flush(): Promise<void>;
  dispose(): void;
}
```

## Comportamento

- **Solo l'ultimo stato voluto per articolo**. `enqueue` sovrascrive lo stato dell'articolo, lo salva nello storage, avvisa con `onChange` e prova subito a mandarlo. `PATCH { checked }` è un valore assoluto, quindi ritentare è sicuro.
- **Una richiesta alla volta per articolo**; articoli diversi partono in parallelo. Se durante un invio l'utente tocca di nuovo la stessa riga, alla fine dell'invio parte una sola richiesta con il valore più recente: due tocchi rapidi non possono arrivare al server fuori ordine.
- **Ripristino**: il costruttore carica dallo storage le spunte rimaste in sospeso ma **non le manda**; partono al primo `flush()` o a un `enqueue` di quell'articolo. La schermata chiama `flush()` appena monta la coda.
- **`flush()`**: annulla il ritentativo programmato e prova a mandare ora tutto ciò che è in coda; si risolve quando gli invii in corso sono finiti (riusciti o no).
- **`dispose()`**: ferma i ritentativi, interrompe gli invii in corso con i loro `AbortController` e ignora gli `enqueue` successivi. Dopo il dispose non parte più nessuna notifica.

### Esito di un invio (`classifyCheckError`)

| Errore | Esito | Effetto |
|---|---|---|
| nessuno | `done` | la spunta esce dalla coda (se nel frattempo non è cambiata) |
| `ApiRequestError` con status 2xx (risposta illeggibile, `invalid_response`) | `done` | il server ha comunque applicato la spunta |
| status `0` (rete, richiesta interrotta), `408`, `429`, `≥ 500` | `retry` | la spunta resta in coda, `stalled = true`, si programma un ritentativo |
| qualsiasi errore che non è un `ApiRequestError` | `retry` | come sopra |
| ogni altro status (es. `400`, `404`, `409`, `422`) | `drop` | la spunta esce dalla coda e si chiama `onDropped` |

### Limite di tempo (innesto R2)

Ogni tentativo ha un proprio `AbortController` e un timer di `CHECK_SEND_TIMEOUT_MS` (10 s) che lo interrompe. `requestJson` trasforma l'interruzione in `network_error`, quindi in un ritentativo ([[http-helpers]]). Senza questo limite una richiesta partita su una connessione ormai morta sarebbe rimasta in sospeso: nessun avviso, nessun ritentativo, e *Aggiorna lista* bloccato in attesa di `flush()` (rischio R2 della review architetturale).

### Ritentativi

- Un solo timer per tutta la coda. L'attesa parte da 2 s e raddoppia a ogni fallimento fino a 30 s; allo scadere chiama `flush()`.
- Un invio riuscito riporta l'attesa al primo valore.
- **Dopo un invio riuscito, se restano spunte in coda con un ritentativo programmato, il ritentativo parte subito**: un invio riuscito prova che la rete c'è, e le spunte ferme non aspettano il loro timer. In quel caso `stalled` resta com'è e lo decide l'esito del ritentativo; se anche quello fallisce, la coda resta ferma e l'attesa cresce di nuovo. È un fix della code review (commit `a5316c7`): prima l'avviso spariva e le spunte ferme aspettavano la vecchia attesa.
- `stalled` torna `false` quando un invio riesce senza altri ritentativi in sospeso, oppure quando la coda si svuota.

## Salvataggio nel Browser

`createLocalCheckStorage(planId)` usa `localStorage` con la chiave `mealy:shopping:pending:<planId>`, una per piano:
- il valore è un oggetto JSON `id articolo → boolean`, validato in lettura (chiavi UUID, valori booleani); un valore malformato vale come coda vuota;
- salvare una coda vuota **rimuove** la chiave;
- non lancia mai: se lo storage non è disponibile (es. navigazione privata) la coda resta in memoria.

`createMemoryCheckStorage` è lo storage in memoria per i test e per gli ambienti senza `localStorage`.

Gli id degli articoli generati sopravvivono a un aggiornamento della lista (`reconcileShoppingItems`, [[shopping-list]]), quindi una spunta in coda resta valida dopo *Aggiorna lista*. Se l'articolo non esiste più, il server risponde 404 e la spunta viene scartata.

## Esempio d'Uso

```ts
import { CheckQueue, createLocalCheckStorage } from '@/lib/shopping/check-queue';
import { patchShoppingItem } from '@/lib/shopping/client';

const queue = new CheckQueue({
  storage: createLocalCheckStorage(planId),
  send: async (itemId, checked, signal) => {
    await patchShoppingItem(itemId, checked, signal);
  },
  onChange: (state) => render(state.pending, state.stalled),
  onDropped: (itemId, error) => report(error),
});

queue.enqueue(itemId, true);   // subito a schermo tramite onChange, poi al server
await queue.flush();           // es. al ritorno della rete
queue.dispose();               // allo smontaggio
```

## Limiti Noti

- La coda protegge una pagina **già aperta**: senza service worker la Lista non si carica senza rete ([[e4-lista-spesa]]).
- Le spunte in coda si vedono solo sul dispositivo che le ha fatte, finché non raggiungono il server.
- Il comportamento reale in modalità aereo e al ritorno della rete è tra le verifiche da telefono rinviate a fine v1 (`requirements.md §5`).

## Test

`tests/shopping/check-queue.test.ts` (timer finti): invio immediato e spunta in sospeso fino alla risposta; mai due richieste in corso per lo stesso articolo e solo l'ultimo stato dopo più tocchi; articoli diversi in parallelo; ritentativi con attese crescenti fino al massimo; coda svuotata e attesa riportata al primo valore dopo un successo; errore generico trattato come errore di rete; `flush` che aspetta l'invio in corso e che annulla il timer; **ritentativo immediato di una spunta ferma quando l'invio di un altro articolo riesce**, e coda ancora ferma se anche quello fallisce; invio che non risponde abbandonato dopo `CHECK_SEND_TIMEOUT_MS`; errori definitivi e risposta 200 illeggibile; ripristino dallo storage senza invii fino a `flush`; `dispose` che annulla il timer, interrompe l'invio in corso e non notifica più; `classifyCheckError` per ogni classe di status; storage su `localStorage` (chiave per piano, chiave rimossa a coda vuota, valore malformato, `localStorage` che lancia).

## Vedi anche

- [[shopping-screen]] — Schermata che crea la coda, mostra le spunte in sospeso e l'avviso
- [[shopping-service]] — `patchShoppingItem` e rotta `PATCH /api/shopping-items/:id`
- [[http-helpers]] — `ApiRequestError`, `network_error`, `invalid_response`
- [[shopping-list]] — Id stabili degli articoli dopo un aggiornamento
- [[e4-lista-spesa]] — Panoramica della Feature 6
