"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { Toast } from "@/components/feedback/toast";
import { AddShoppingItemSheet } from "@/components/shopping/add-item-sheet";
import {
  ShoppingItemRow,
  type ShoppingItem,
} from "@/components/shopping/shopping-item-row";
import { Button } from "@/components/ui/button";
import {
  formatShoppingQuantity,
  groupShoppingItems,
  shoppingItemLabel,
  shoppingProgress,
} from "@/lib/domain/shopping-list";
import type {
  PlanShoppingListView,
  ShoppingItemView,
  ShoppingPlanRef,
  ShoppingScreenView,
} from "@/lib/domain/types";
import { ApiRequestError, apiErrorMessage } from "@/lib/http/client";
import { formatWeekRange } from "@/lib/plans/format";
import { cn } from "@/lib/utils";
import {
  CheckQueue,
  createLocalCheckStorage,
  type CheckQueueState,
} from "@/lib/shopping/check-queue";
import {
  deleteShoppingItem,
  fetchPlanShoppingList,
  patchShoppingItem,
  postShoppingItem,
  requestBuildShoppingList,
} from "@/lib/shopping/client";

export interface ShoppingScreenProps {
  initialScreen: ShoppingScreenView;
}

const TOAST_CREATED = "Lista creata";
const TOAST_UPDATED = "Lista aggiornata";
const TOAST_PENDING_BLOCK = "Ci sono spunte in attesa di rete: riprova quando torna la connessione.";
const STALE_NOTICE = "Il piano è cambiato: aggiorna la lista per allinearla.";
const REBUILD_CONFIRM =
  "Aggiorno la lista dal piano di adesso? Le spunte restano dove la quantità non aumenta; gli articoli aggiunti a mano non cambiano.";
const READ_ONLY_NOTICE = "Questa settimana è conclusa: la lista si può solo consultare.";
const EMPTY_ITEMS = "Niente da comprare per i pasti che restano.";
const ALL_DONE = "Hai preso tutto.";
const MANUAL_DETAIL = "Aggiunto a mano";
const pendingLabel = (count: number) =>
  count === 1 ? "1 spunta in attesa di rete" : `${count} spunte in attesa di rete`;
const LIST_CREATE_LABEL = "Crea lista della spesa";
// Stessa etichetta di attesa del footer del Piano (components/plan/plan-screen.tsx).
const LIST_CREATING_LABEL = "Creo la lista…";
const HTTP_NOT_FOUND = 404;
const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX_EXCLUSIVE = 300;

const NO_PLAN_ERROR_MESSAGE = "Nessun piano selezionato.";

/** Risposta 2xx rifiutata solo perché illeggibile: il server ha comunque applicato la richiesta. */
function isUnreadableSuccess(err: unknown): boolean {
  return (
    err instanceof ApiRequestError &&
    err.status >= HTTP_SUCCESS_MIN &&
    err.status < HTTP_SUCCESS_MAX_EXCLUSIVE
  );
}

/** Articoli con le spunte in coda al posto dello stato del server. */
function withPending(
  items: readonly ShoppingItemView[],
  pending: ReadonlyMap<string, boolean>
): ShoppingItemView[] {
  return items.map((item) => {
    const checked = pending.get(item.id);
    return checked === undefined ? item : { ...item, checked };
  });
}

/** "Per: Pasta al pomodoro, Insalata": i titoli trovati, nell'ordine degli id; altrimenti nulla. */
function perLabel(
  ids: readonly string[],
  titles: ReadonlyMap<string, string>
): string | undefined {
  const found = ids.flatMap((id) => {
    const title = titles.get(id);
    return title === undefined ? [] : [title];
  });
  return found.length === 0 ? undefined : `Per: ${found.join(", ")}`;
}

function toRow(item: ShoppingItemView, titles: ReadonlyMap<string, string>): ShoppingItem {
  return {
    id: item.id,
    name: shoppingItemLabel(item.canonical_name),
    isChecked: item.checked,
    quantityLabel: formatShoppingQuantity(item.qty, item.unit),
    detail: item.manual ? MANUAL_DETAIL : perLabel(item.recipe_ids, titles),
  };
}

export function ShoppingScreen({ initialScreen }: ShoppingScreenProps): React.JSX.Element {
  const router = useRouter();
  const [view, setView] = React.useState<PlanShoppingListView | null>(initialScreen.selected);
  // Stessa `key` ma dati nuovi dal server (es. `router.refresh()`): si riallinea lo stato.
  const [syncedInitialScreen, setSyncedInitialScreen] = React.useState(initialScreen);
  if (syncedInitialScreen !== initialScreen) {
    setSyncedInitialScreen(initialScreen);
    setView(initialScreen.selected);
  }
  const [queueState, setQueueState] = React.useState<CheckQueueState>({
    pending: new Map(),
    stalled: false,
  });
  const [toast, setToast] = React.useState<string | null>(null);
  const [isBuilding, setIsBuilding] = React.useState(false);
  const [confirmingRebuild, setConfirmingRebuild] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);

  // Le risposte possono arrivare dopo lo smontaggio (cambio di piano o di pagina).
  const mountedRef = React.useRef(false);
  const queueRef = React.useRef<CheckQueue | null>(null);
  const refreshRef = React.useRef<() => Promise<void>>(() => Promise.resolve());
  // Conta le modifiche confermate dal server (spunte, aggiunte, rimozioni, creazioni): una rilettura
  // che parte prima di una modifica non la può cancellare.
  const mutationSeqRef = React.useRef(0);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const planId = view?.plan.id ?? null;
  const serverItems = view?.list?.items;
  const recipes = view?.list?.recipes;
  const list = view?.list ?? null;

  const applyServerItem = React.useCallback((saved: ShoppingItemView) => {
    setView((prev) =>
      prev && prev.list
        ? {
            ...prev,
            list: {
              ...prev.list,
              items: prev.list.items.map((item) => (item.id === saved.id ? saved : item)),
            },
          }
        : prev
    );
  }, []);

  const refresh = async (): Promise<void> => {
    if (planId === null) return;
    const seq = mutationSeqRef.current;
    let fresh: PlanShoppingListView;
    try {
      fresh = await fetchPlanShoppingList(planId);
    } catch {
      // Senza rete la rilettura riparte al prossimo evento (ritorno in primo piano o rete).
      return;
    }
    if (!mountedRef.current) return;
    if (mutationSeqRef.current !== seq) {
      // Una modifica è stata confermata mentre la vista era in viaggio: la vista potrebbe non contenerla.
      void refreshRef.current();
      return;
    }
    setView(fresh);
  };

  React.useEffect(() => {
    refreshRef.current = refresh;
  });

  // La coda si crea solo qui: `localStorage` non esiste sul server.
  React.useEffect(() => {
    if (planId === null) return;
    const queue = new CheckQueue({
      storage: createLocalCheckStorage(planId),
      send: async (itemId, checked, signal) => {
        let saved: ShoppingItemView;
        try {
          saved = await patchShoppingItem(itemId, checked, signal);
        } catch (err) {
          if (isUnreadableSuccess(err)) {
            // La coda la darà per inviata: il server ha la spunta, la vista a schermo va riletta.
            mutationSeqRef.current += 1;
            void refreshRef.current();
          }
          throw err;
        }
        mutationSeqRef.current += 1;
        applyServerItem(saved);
      },
      onChange: setQueueState,
      onDropped: (_itemId, err) => {
        if (!(err instanceof ApiRequestError && err.status === HTTP_NOT_FOUND)) {
          setToast(apiErrorMessage(err));
        }
        void refreshRef.current();
      },
    });
    queueRef.current = queue;
    setQueueState(queue.state);
    // Anche la schermata riaperta con il tasto Indietro riparte da dati del server, non dalla cache del router.
    // Se nel frattempo la coda è stata smontata, la rilettura non parte.
    void queue.flush().then(() => {
      if (queueRef.current === queue) void refreshRef.current();
    });
    return () => {
      queue.dispose();
      queueRef.current = null;
    };
  }, [planId, applyServerItem]);

  // Al ritorno in primo piano o con la rete di nuovo presente: spunte in coda e rilettura.
  React.useEffect(() => {
    if (planId === null) return;
    const resync = (): void => {
      void (async () => {
        await queueRef.current?.flush();
        await refreshRef.current();
      })();
    };
    const onVisibilityChange = (): void => {
      if (document.visibilityState === "visible") resync();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", resync);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", resync);
    };
  }, [planId]);

  const items = React.useMemo(
    () => withPending(serverItems ?? [], queueState.pending),
    [serverItems, queueState.pending]
  );
  const titles = React.useMemo(
    () =>
      new Map((recipes ?? []).map((recipe): [string, string] => [recipe.id, recipe.title])),
    [recipes]
  );
  const sections = React.useMemo(() => groupShoppingItems(items), [items]);
  const progress = shoppingProgress(items);

  const showPendingNotice = queueState.stalled && queueState.pending.size > 0;
  const showFab = view !== null && list !== null && view.editable;

  const handleToggle = (id: string): void => {
    if (!view?.editable) return;
    const current = items.find((item) => item.id === id);
    if (!current) return;
    queueRef.current?.enqueue(id, !current.checked);
  };

  const runBuild = async (): Promise<void> => {
    if (planId === null || !view || isBuilding) return;
    const hadList = view.list !== null;
    setIsBuilding(true);
    try {
      await queueRef.current?.flush();
      if ((queueRef.current?.state.pending.size ?? 0) > 0) {
        setToast(TOAST_PENDING_BLOCK);
        return;
      }
      const seq = mutationSeqRef.current;
      const fresh = await requestBuildShoppingList(planId);
      if (!mountedRef.current) return;
      const changedMeanwhile = mutationSeqRef.current !== seq;
      // Una rilettura partita prima della costruzione non deve sostituirla.
      mutationSeqRef.current += 1;
      setView(fresh);
      setToast(hadList ? TOAST_UPDATED : TOAST_CREATED);
      if (changedMeanwhile) void refreshRef.current();
    } catch (err) {
      if (mountedRef.current) setToast(apiErrorMessage(err));
    } finally {
      if (mountedRef.current) {
        setIsBuilding(false);
        setConfirmingRebuild(false);
      }
    }
  };

  const handleRebuildClick = (): void => {
    if (items.some((item) => item.checked && !item.manual)) setConfirmingRebuild(true);
    else void runBuild();
  };

  // Gli errori non si catturano: li mostra il pannello di aggiunta.
  const handleAdd = async (name: string): Promise<string> => {
    if (planId === null) throw new Error(NO_PLAN_ERROR_MESSAGE);
    const item = await postShoppingItem(planId, name);
    mutationSeqRef.current += 1;
    setView((prev) => {
      if (!prev?.list) return prev;
      const exists = prev.list.items.some((existing) => existing.id === item.id);
      const nextItems = exists
        ? prev.list.items.map((existing) => (existing.id === item.id ? item : existing))
        : [...prev.list.items, item];
      return { ...prev, list: { ...prev.list, items: nextItems } };
    });
    return shoppingItemLabel(item.canonical_name);
  };

  const handleRemove = async (id: string): Promise<void> => {
    const removed = view?.list?.items.find((item) => item.id === id);
    if (!removed) return;
    setView((prev) =>
      prev && prev.list
        ? {
            ...prev,
            list: { ...prev.list, items: prev.list.items.filter((item) => item.id !== id) },
          }
        : prev
    );
    try {
      await deleteShoppingItem(id);
      mutationSeqRef.current += 1;
    } catch (err) {
      // 404: l'articolo non c'è più sul server, il risultato è già quello voluto.
      if (err instanceof ApiRequestError && err.status === HTTP_NOT_FOUND) {
        mutationSeqRef.current += 1;
        return;
      }
      if (!mountedRef.current) return;
      setView((prev) =>
        prev && prev.list && !prev.list.items.some((item) => item.id === removed.id)
          ? { ...prev, list: { ...prev.list, items: [...prev.list.items, removed] } }
          : prev
      );
      setToast(apiErrorMessage(err));
    }
  };

  const weekRange = view ? formatWeekRange(view.plan.week_start, view.plan.last_day) : null;
  const headerRebuild =
    view?.list && view.can_build && !view.list.needs_regeneration ? (
      <Button variant="outline" size="sm" onClick={handleRebuildClick} disabled={isBuilding}>
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
        <span>Aggiorna lista</span>
      </Button>
    ) : null;

  let body: React.ReactNode;
  if (view === null) {
    body = (
      <EmptyState
        title="Nessuna lista della spesa"
        description="Conferma il piano della settimana: da lì crei la lista con un tocco."
        actionLabel="Vai al piano"
        onAction={() => router.push("/")}
      />
    );
  } else if (view.list === null) {
    if (view.can_build) {
      // Il pulsante è fuori da EmptyState, che non ne prevede lo stato disabilitato.
      body = (
        <>
          <EmptyState
            title="Lista da creare"
            description={`Raccolgo gli ingredienti del piano ${weekRange} e li ordino per reparto.`}
            className="pb-0"
          />
          <div className="flex justify-center pb-12">
            <Button onClick={() => void runBuild()} disabled={isBuilding}>
              {isBuilding ? LIST_CREATING_LABEL : LIST_CREATE_LABEL}
            </Button>
          </div>
        </>
      );
    } else if (view.editable) {
      body = (
        <EmptyState
          title="Piano non ancora confermato"
          description="Conferma il piano per creare la lista della spesa."
          actionLabel="Vai al piano"
          onAction={() => router.push(`/?settimana=${view.plan.week_start}`)}
        />
      );
    } else {
      body = (
        <EmptyState
          title="Nessuna lista per questa settimana"
          description="Questa settimana è conclusa e non aveva una lista."
        />
      );
    }
  } else {
    body = (
      <>
        {!view.editable && (
          <p className="mb-4 rounded-xl border border-stone/30 bg-stone/10 p-3 text-sm text-ink">
            {READ_ONLY_NOTICE}
          </p>
        )}

        {view.list.needs_regeneration && view.can_build && (
          <div className="mb-4 flex flex-col items-start gap-2 rounded-xl border border-saffron/40 bg-saffron/10 p-3 text-sm text-ink">
            <p>{STALE_NOTICE}</p>
            <Button size="sm" onClick={handleRebuildClick} disabled={isBuilding}>
              Aggiorna lista
            </Button>
          </div>
        )}

        {confirmingRebuild && (
          <div className="mb-4 rounded-xl border border-stone/30 bg-white p-3 text-sm text-ink">
            <p>{REBUILD_CONFIRM}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => void runBuild()} disabled={isBuilding}>
                Aggiorna
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmingRebuild(false)}>
                Annulla
              </Button>
            </div>
          </div>
        )}

        {/* Regione sempre montata: una live region che compare già piena non viene annunciata bene. */}
        <div
          role="status"
          className={cn(
            showPendingNotice && "mb-4 rounded-xl border border-stone/30 bg-stone/10 p-3 text-sm text-ink"
          )}
        >
          {showPendingNotice ? pendingLabel(queueState.pending.size) : null}
        </div>

        {progress.total > 0 && (
          <div className="mb-5 rounded-xl border border-stone/20 bg-white p-3.5">
            <div className="mb-1.5 flex items-center justify-between text-xs font-semibold">
              <span className="text-stone">Progresso spesa</span>
              <span className="text-basil tabular-nums">
                {progress.checked}/{progress.total}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Articoli presi"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.checked}
              className="h-2 w-full overflow-hidden rounded-full bg-stone/15"
            >
              <div
                className="h-full bg-basil transition-all duration-300 motion-reduce:transition-none"
                style={{ width: `${Math.round((progress.checked / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {progress.total === 0 && (
          <p className="py-8 text-center text-sm text-stone">{EMPTY_ITEMS}</p>
        )}

        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.category} className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <h2 className="font-display text-base font-bold text-ink tracking-tight">
                  {section.label}
                </h2>
                <span className="text-xs text-stone tabular-nums">
                  {section.checked}/{section.total}
                </span>
              </div>
              <div className="divide-y divide-stone/15 rounded-xl border border-stone/20 bg-white p-1">
                {section.items.map((item) => (
                  <ShoppingItemRow
                    key={item.id}
                    item={toRow(item, titles)}
                    onToggle={handleToggle}
                    disabled={!view.editable}
                    onRemove={
                      item.manual && view.editable ? (id) => void handleRemove(id) : undefined
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        {progress.total > 0 && progress.checked === progress.total && (
          <p className="mt-8 rounded-xl bg-basil/10 p-4 text-center text-sm font-semibold text-basil">
            {ALL_DONE}
          </p>
        )}

        {showFab && (
          <>
            <Button
              aria-label="Aggiungi un articolo alla lista"
              onClick={() => setAddOpen(true)}
              className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 h-14 rounded-full px-5 text-base font-semibold shadow-lg"
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
              <span>Aggiungi</span>
            </Button>
            <AddShoppingItemSheet
              open={addOpen}
              onClose={() => setAddOpen(false)}
              onAdd={handleAdd}
            />
          </>
        )}
      </>
    );
  }

  const subtitle = weekRange ? `Settimana ${weekRange}` : "Consolidata dal piano settimanale";

  return (
    <main className={cn("mx-auto max-w-xl px-4 py-6", showFab && "pb-24")}>
      <header className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Lista della Spesa</h1>
          <p className="mt-0.5 text-xs text-stone">{subtitle}</p>
        </div>
        {headerRebuild}
      </header>

      {initialScreen.plans.length >= 2 && (
        <nav aria-label="Liste della spesa" className="mb-4 flex gap-2">
          {initialScreen.plans.map((plan: ShoppingPlanRef) => {
            const isShown = plan.id === planId;
            return (
              <Link
                key={plan.id}
                href={`/lista?piano=${plan.id}`}
                aria-current={isShown ? "page" : undefined}
                className={cn(
                  "flex min-h-[44px] flex-1 items-center justify-center rounded-xl border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil",
                  isShown
                    ? "border-basil bg-basil text-paper"
                    : "border-stone/30 text-ink hover:bg-stone/10"
                )}
              >
                {formatWeekRange(plan.week_start, plan.last_day)}
              </Link>
            );
          })}
        </nav>
      )}

      {body}

      <Toast
        message={toast}
        onDismiss={() => setToast(null)}
        // Sopra il pulsante Aggiungi.
        className={showFab ? "bottom-[calc(9.5rem+env(safe-area-inset-bottom))]" : undefined}
      />
    </main>
  );
}
