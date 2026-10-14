"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  RefreshCw,
  ShoppingBag,
  Sparkles,
} from "lucide-react";
import { GenerationProgress } from "@/components/plan/generation-progress";
import { PlanSlotCard } from "@/components/plan/plan-slot-card";
import { EmptyState } from "@/components/feedback/empty-state";
import { Toast } from "@/components/feedback/toast";
import {
  RecipeDetailSheet,
  type RecipePrefChanges,
} from "@/components/recipes/recipe-detail-sheet";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { applyRecipePrefPatch, defaultRecipePref } from "@/lib/domain/prefs";
import type {
  GeneratePlanResult,
  PlanScreenView,
  PlanSlotView,
  PlanView,
} from "@/lib/domain/types";
import { apiErrorMessage } from "@/lib/http/client";
import { putRecipePref } from "@/lib/prefs/client";
import {
  PlanRequestError,
  fetchPlanScreen,
  requestConfirmPlan,
  requestGeneratePlan,
  requestRepeatPlan,
  requestSlotLock,
} from "@/lib/plans/client";
import { formatDayLabel, formatWeekRange } from "@/lib/plans/format";
import { fetchPlanShoppingList, requestBuildShoppingList } from "@/lib/shopping/client";

export interface PlanScreenProps {
  initialScreen: PlanScreenView;
}

type TargetRequestKind = "generate" | "repeat";
/** generated_at del piano obiettivo prima della richiesta; null se non c'era; undefined se ignoto. */
type TargetBaseline = string | null | undefined;

const NETWORK_ERROR_CODE = "network_error";
const GENERATION_SKELETON_CARDS = 4;

const TOAST_GENERATED = "Piano generato";
const TOAST_GENERATED_FALLBACK = "Piano generato con le ricette della libreria.";
const TOAST_REPEATED = "Piano ripetuto";
const TOAST_CONFIRMED = "Piano confermato";
const TOAST_BLOCKED_IN_PLAN =
  "Non la proporrò più. In questo piano resta: usa Cambia per sostituirla.";
const LIST_CREATE_LABEL = "Crea lista della spesa";
const LIST_CREATING_LABEL = "Creo la lista…";
const LIST_OPEN_LABEL = "Vai alla lista della spesa";
const LIST_STALE_LABEL = "Lista della spesa da aggiornare";

const RECOVERY_WAIT_MESSAGE = "La connessione si è interrotta: controllo se il piano è pronto…";
// Dopo un `network_error` il server di solito sta ancora generando: si ricontrolla con
// backoff fino al caso peggiore della rotta (`maxDuration`), contato dall'invio.
const RECOVERY_FIRST_DELAY_MS = 2_000;
const RECOVERY_MAX_DELAY_MS = 30_000;
const RECOVERY_WINDOW_MS: Record<TargetRequestKind, number> = {
  generate: 500_000,
  repeat: 250_000,
};

// Quando dopo Genera/Ripeti si passa alla settimana obiettivo la pagina viene
// rimontata (nuova `key`): il toast attraversa il rimontaggio tramite questo slot,
// e vale solo per la settimana verso cui si è navigato.
let pendingToast: { message: string; weekStart: string } | null = null;

/** Scarta il toast in attesa di rimontaggio (usato dai test per isolarsi). */
export function discardPendingPlanToast(): void {
  pendingToast = null;
}

function weekHref(weekStart: string): string {
  return `/?settimana=${weekStart}`;
}

function recoveryDelayMs(attempt: number): number {
  return Math.min(RECOVERY_FIRST_DELAY_MS * 2 ** (attempt - 1), RECOVERY_MAX_DELAY_MS);
}

/** Aggiorna il piano della settimana mostrata, allineando azione e stato dell'obiettivo. */
function withPlan(screen: PlanScreenView, plan: PlanView): PlanScreenView {
  const isTarget = screen.view.week.week_start === screen.target.week_start;
  return {
    ...screen,
    target_plan_status: isTarget ? plan.status : screen.target_plan_status,
    view: {
      ...screen.view,
      plan,
      action: isTarget ? (plan.status === "draft" ? "regenerate" : "none") : screen.view.action,
    },
  };
}

/**
 * Applica solo i campi `pick` dello slot `slotId` presi dall'istantanea del server. Le
 * risposte di swap e blocco possono arrivare fuori ordine: sostituire l'intero piano
 * annullerebbe le modifiche degli altri slot applicate nel frattempo.
 */
function withSlotFrom(
  screen: PlanScreenView,
  serverPlan: PlanView,
  slotId: string,
  pick: (serverSlot: PlanSlotView) => Partial<PlanSlotView>,
  planFields: Partial<Pick<PlanView, "shopping_list">> = {}
): PlanScreenView {
  const plan = screen.view.plan;
  const serverSlot = serverPlan.slots.find((slot) => slot.id === slotId);
  if (!plan || plan.id !== serverPlan.id || !serverSlot) return screen;
  const slots = plan.slots.map((slot) =>
    slot.id === slotId ? { ...slot, ...pick(serverSlot) } : slot
  );
  return { ...screen, view: { ...screen.view, plan: { ...plan, ...planFields, slots } } };
}

function groupByDay(slots: readonly PlanSlotView[]): { day: string; slots: PlanSlotView[] }[] {
  const groups: { day: string; slots: PlanSlotView[] }[] = [];
  for (const slot of slots) {
    const last = groups[groups.length - 1];
    if (last && last.day === slot.day) last.slots.push(slot);
    else groups.push({ day: slot.day, slots: [slot] });
  }
  return groups;
}

interface WeekNavLinkProps {
  href: string | null;
  /** Durante la generazione: l'esito va applicato alla settimana che l'ha chiesta. */
  disabled?: boolean;
  direction: "prev" | "next";
  onNavigate: (href: string) => void;
}

const NAV_LINK_CLASS =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink transition-colors";

function WeekNavLink({
  href,
  disabled = false,
  direction,
  onNavigate,
}: WeekNavLinkProps): React.JSX.Element {
  const label = direction === "prev" ? "Settimana precedente" : "Settimana successiva";
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;

  if (href === null || disabled) {
    return (
      <span
        role="link"
        aria-disabled="true"
        aria-label={label}
        className={cn(NAV_LINK_CLASS, "cursor-not-allowed text-stone opacity-40")}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      onClick={(e) => {
        // Clic normale: navigazione in transizione; modificatori e tasto centrale restano al browser.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onNavigate(href);
      }}
      className={cn(
        NAV_LINK_CLASS,
        "hover:bg-stone/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil"
      )}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </Link>
  );
}

export function PlanScreen({ initialScreen }: PlanScreenProps): React.JSX.Element {
  const router = useRouter();
  const [isNavigating, startNavigation] = React.useTransition();
  const [screen, setScreen] = React.useState<PlanScreenView>(initialScreen);
  // Stessa `key` ma dati nuovi dal server (es. `router.refresh()`): si riallinea lo stato.
  const [syncedInitialScreen, setSyncedInitialScreen] = React.useState(initialScreen);
  if (syncedInitialScreen !== initialScreen) {
    setSyncedInitialScreen(initialScreen);
    setScreen(initialScreen);
  }
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [isRecovering, setIsRecovering] = React.useState(false);
  const [generateError, setGenerateError] = React.useState<string | null>(null);
  const [isConfirming, setIsConfirming] = React.useState(false);
  const [isCreatingList, setIsCreatingList] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [sheetSlotId, setSheetSlotId] = React.useState<string | null>(null);

  // Le richieste lunghe possono finire dopo lo smontaggio (cambio di settimana o di pagina).
  const mountedRef = React.useRef(false);
  const stopRecoveryRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopRecoveryRef.current?.();
    };
  }, []);

  // Recupera il toast lasciato dalla pagina che ha navigato verso questa settimana;
  // se si è finiti altrove, lo scarta.
  const mountedWeekStart = React.useRef(initialScreen.view.week.week_start);
  React.useEffect(() => {
    const pending = pendingToast;
    pendingToast = null;
    if (pending && pending.weekStart === mountedWeekStart.current) setToast(pending.message);
  }, []);

  // Stato della lista già deciso da un'azione dell'utente: la rilettura di apertura, più vecchia, non lo sovrascrive.
  const shoppingListTouchedRef = React.useRef(false);
  const mountedScreenRef = React.useRef(initialScreen);

  // Tornando indietro il router può riproporre un piano in cache: lo stato della lista (solo quello) si rilegge.
  React.useEffect(() => {
    const mountedPlan = mountedScreenRef.current.view.plan;
    if (!mountedPlan || mountedPlan.status !== "active" || !mountedScreenRef.current.view.editable) {
      return;
    }
    const planId = mountedPlan.id;
    let cancelled = false;
    void (async () => {
      let fresh: Awaited<ReturnType<typeof fetchPlanShoppingList>>;
      try {
        fresh = await fetchPlanShoppingList(planId);
      } catch {
        // Senza rete resta lo stato già a schermo.
        return;
      }
      if (cancelled || shoppingListTouchedRef.current || fresh.plan.id !== planId) return;
      const next = {
        exists: fresh.list !== null,
        needs_regeneration: fresh.list?.needs_regeneration ?? false,
      };
      setScreen((prev) => {
        const current = prev.view.plan;
        if (!current || current.id !== planId) return prev;
        const same =
          current.shopping_list.exists === next.exists &&
          current.shopping_list.needs_regeneration === next.needs_regeneration;
        if (same) return prev;
        return {
          ...prev,
          view: { ...prev.view, plan: { ...current, shopping_list: next } },
        };
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { view, target } = screen;
  const plan = view.plan;
  const isTargetShown = view.week.week_start === target.week_start;
  const targetRange = formatWeekRange(target.first_day, target.last_day);
  const range = plan
    ? formatWeekRange(view.week.week_start, view.week.last_day)
    : formatWeekRange(view.week.first_day, view.week.last_day);

  const navigate = (href: string, mode: "push" | "replace" = "push"): void => {
    startNavigation(() => {
      if (mode === "replace") router.replace(href);
      else router.push(href);
    });
  };

  const sheetSlot = React.useMemo(
    () => plan?.slots.find((slot) => slot.id === sheetSlotId) ?? null,
    [plan, sheetSlotId]
  );

  /** Fonde i campi cambiati nelle preferenze della ricetta, in tutti gli slot del piano mostrato. */
  const applyRecipePrefs = (recipeId: string, changed: RecipePrefChanges): void => {
    setScreen((prev) => {
      const current = prev.view.plan;
      if (!current || !current.slots.some((slot) => slot.recipe?.id === recipeId)) return prev;
      const slots = current.slots.map((slot) => {
        if (slot.recipe?.id !== recipeId) return slot;
        const merged = { ...(slot.recipe.prefs ?? defaultRecipePref(recipeId)), ...changed };
        // Una ricetta bloccata non è mai preferita: una risposta tardiva della ★ non lo annulla.
        const prefs = merged.blocked ? { ...merged, favorite: false } : merged;
        return { ...slot, recipe: { ...slot.recipe, prefs } };
      });
      return { ...prev, view: { ...prev.view, plan: { ...current, slots } } };
    });
  };

  // Ricette con un salvataggio della ★ in corso: un secondo tocco viene ignorato.
  const savingFavoriteRef = React.useRef<Set<string>>(new Set());

  const handleToggleFavorite = async (recipeId: string): Promise<void> => {
    const recipe = plan?.slots.find((slot) => slot.recipe?.id === recipeId)?.recipe;
    if (!recipe || savingFavoriteRef.current.has(recipeId)) return;
    const current = recipe.prefs ?? defaultRecipePref(recipeId);
    const nextFavorite = !current.favorite;
    savingFavoriteRef.current.add(recipeId);
    // Solo `favorite`: un voto dato nel frattempo dal dettaglio non va sovrascritto.
    applyRecipePrefs(recipeId, {
      favorite: applyRecipePrefPatch(current, { favorite: nextFavorite }).favorite,
    });
    try {
      const saved = await putRecipePref(recipeId, { favorite: nextFavorite });
      applyRecipePrefs(recipeId, { favorite: saved.favorite });
    } catch (err) {
      applyRecipePrefs(recipeId, { favorite: current.favorite });
      setToast(apiErrorMessage(err));
    } finally {
      savingFavoriteRef.current.delete(recipeId);
    }
  };

  /**
   * Adotta l'esito di Genera/Rigenera/Ripeti: aggiorna lo stato o passa alla settimana
   * obiettivo. Restituisce `true` se naviga (il rimontaggio azzererà lo stato).
   */
  const adoptTargetScreen = (next: PlanScreenView, message: string): boolean => {
    if (!mountedRef.current) {
      // L'utente ha già lasciato questa schermata: si rilegge quella che sta guardando.
      router.refresh();
      return false;
    }
    setToast(message);
    if (isTargetShown) {
      setScreen(next);
      return false;
    }
    pendingToast = { message, weekStart: target.week_start };
    navigate(weekHref(target.week_start), "replace");
    return true;
  };

  /** Bozza obiettivo esistente ma non mostrata: la base si legge dal server (il suo orologio). */
  const readHiddenTargetBaseline = async (): Promise<TargetBaseline> => {
    try {
      return (await fetchPlanScreen(target.week_start)).view.plan?.generated_at ?? null;
    } catch {
      return undefined;
    }
  };

  /** Il piano obiettivo attuale, se più recente della base; altrimenti `null`. */
  const checkTargetScreen = async (baseline: string | null): Promise<PlanScreenView | null> => {
    try {
      const fresh = await fetchPlanScreen(target.week_start);
      const freshPlan = fresh.view.plan;
      if (!freshPlan) return null;
      if (baseline === null) return fresh;
      return Date.parse(freshPlan.generated_at) > Date.parse(baseline) ? fresh : null;
    } catch {
      return null;
    }
  };

  /** Dopo un errore di rete il server può aver salvato il piano, anche più tardi (R1). */
  const recoverTargetScreen = async (
    kind: TargetRequestKind,
    startedAtMs: number,
    baseline: TargetBaseline
  ): Promise<PlanScreenView | null> => {
    if (baseline === undefined) return null;
    let stopped = false;
    let wake: (() => void) | null = null;
    stopRecoveryRef.current = () => {
      stopped = true;
      wake?.();
    };
    setIsRecovering(true);
    try {
      for (let attempt = 0; ; attempt++) {
        if (attempt > 0) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, recoveryDelayMs(attempt));
            wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
        }
        if (stopped) return null;
        const fresh = await checkTargetScreen(baseline);
        if (stopped) return null;
        if (fresh) return fresh;
        if (Date.now() - startedAtMs >= RECOVERY_WINDOW_MS[kind]) return null;
      }
    } finally {
      stopRecoveryRef.current = null;
      if (mountedRef.current) setIsRecovering(false);
    }
  };

  const runTargetRequest = async (
    kind: TargetRequestKind,
    request: () => Promise<GeneratePlanResult>
  ): Promise<void> => {
    setIsGenerating(true);
    setGenerateError(null);
    const startedAtMs = Date.now();
    // Base per riconoscere il piano salvato dal server dopo un errore di rete (R1).
    let baseline: TargetBaseline = isTargetShown
      ? (screen.view.plan?.generated_at ?? null)
      : screen.target_plan_status === null
        ? null
        : undefined;
    if (baseline === undefined) baseline = await readHiddenTargetBaseline();
    const successMessage = kind === "generate" ? TOAST_GENERATED : TOAST_REPEATED;
    let navigating = false;
    try {
      const result = await request();
      const message =
        kind === "generate" && result.generation.failed ? TOAST_GENERATED_FALLBACK : successMessage;
      navigating = adoptTargetScreen(result.screen, message);
    } catch (err) {
      const recovered =
        err instanceof PlanRequestError && err.code === NETWORK_ERROR_CODE
          ? await recoverTargetScreen(kind, startedAtMs, baseline)
          : null;
      if (recovered) {
        navigating = adoptTargetScreen(recovered, successMessage);
      } else if (!mountedRef.current) {
        return;
      } else if (kind === "generate") {
        setGenerateError(apiErrorMessage(err));
      } else {
        setToast(apiErrorMessage(err));
      }
    } finally {
      // Se si naviga, la vecchia settimana resta visibile finché arriva la nuova: niente
      // doppio invio (il rimontaggio azzera lo stato).
      if (mountedRef.current && !navigating) setIsGenerating(false);
    }
  };

  const handleGenerate = (): void => {
    void runTargetRequest("generate", requestGeneratePlan);
  };

  const handleRepeat = (sourcePlanId: string): void => {
    void runTargetRequest("repeat", () => requestRepeatPlan(sourcePlanId));
  };

  const handleConfirm = async (): Promise<void> => {
    if (!plan) return;
    setIsConfirming(true);
    try {
      const result = await requestConfirmPlan(plan.id);
      setScreen((prev) => withPlan(prev, result.plan));
      setToast(TOAST_CONFIRMED);
    } catch (err) {
      setToast(apiErrorMessage(err));
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCreateList = async (): Promise<void> => {
    if (!plan || isCreatingList) return;
    const planId = plan.id;
    setIsCreatingList(true);
    try {
      await requestBuildShoppingList(planId);
      shoppingListTouchedRef.current = true;
      if (!mountedRef.current) return;
      setScreen((prev) =>
        prev.view.plan && prev.view.plan.id === planId
          ? withPlan(prev, {
              ...prev.view.plan,
              shopping_list: { exists: true, needs_regeneration: false },
            })
          : prev
      );
      navigate(`/lista?piano=${planId}`);
    } catch (err) {
      if (mountedRef.current) setToast(apiErrorMessage(err));
    } finally {
      if (mountedRef.current) setIsCreatingList(false);
    }
  };

  const setSlotLocked = (slotId: string, locked: boolean): void => {
    setScreen((prev) => {
      if (!prev.view.plan) return prev;
      const slots = prev.view.plan.slots.map((slot) =>
        slot.id === slotId ? { ...slot, locked } : slot
      );
      return { ...prev, view: { ...prev.view, plan: { ...prev.view.plan, slots } } };
    });
  };

  const handleToggleLock = async (slotId: string): Promise<void> => {
    const slot = plan?.slots.find((candidate) => candidate.id === slotId);
    if (!plan || !slot) return;
    const nextLocked = !slot.locked;
    setSlotLocked(slotId, nextLocked);
    try {
      const result = await requestSlotLock(plan.id, slotId, nextLocked);
      setScreen((prev) =>
        withSlotFrom(prev, result.plan, slotId, (serverSlot) => ({ locked: serverSlot.locked }))
      );
    } catch (err) {
      setSlotLocked(slotId, !nextLocked);
      setToast(apiErrorMessage(err));
    }
  };

  const actionButton =
    view.action === "none" ? null : (
      <Button size="sm" onClick={handleGenerate} disabled={isGenerating} className="shadow-sm">
        {view.action === "generate" ? (
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        ) : (
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        )}
        <span>{view.action === "generate" ? "Genera piano" : "Rigenera"}</span>
      </Button>
    );

  const showSupersededNotice = plan !== null && plan.superseded && view.editable;
  const isWeekendCurrentWeek =
    view.week.week_start === screen.current_week_start &&
    screen.current_week_start !== target.week_start;

  let body: React.ReactNode;
  if (isGenerating) {
    body = <GenerationProgress cards={GENERATION_SKELETON_CARDS} />;
  } else if (plan) {
    body = (
      <div className="flex flex-col gap-6">
        {groupByDay(plan.slots).map((group) => (
          <section key={group.day} className="flex flex-col gap-3">
            <h3 className="font-display text-lg font-bold text-ink">
              {formatDayLabel(group.day)}
            </h3>
            {group.slots.map((slot) => (
              <PlanSlotCard
                key={slot.id}
                planId={plan.id}
                slot={slot}
                editable={view.editable}
                swappable={slot.day >= screen.today}
                onPlanChange={(next) => {
                  shoppingListTouchedRef.current = true;
                  setScreen((prev) =>
                    withSlotFrom(
                      prev,
                      next,
                      slot.id,
                      (serverSlot) => ({ recipe: serverSlot.recipe, servings: serverSlot.servings }),
                      { shopping_list: next.shopping_list }
                    )
                  );
                }}
                onToggleLock={(slotId) => void handleToggleLock(slotId)}
                onSelectRecipe={(selected) => setSheetSlotId(selected.id)}
                onToggleFavorite={(recipeId) => void handleToggleFavorite(recipeId)}
                onRecipePrefsChange={applyRecipePrefs}
                onPlanStale={() => router.refresh()}
                onError={setToast}
              />
            ))}
          </section>
        ))}
      </div>
    );
  } else if (isTargetShown && view.action !== "none") {
    body = (
      <>
        <EmptyState
          title="Nessun piano in programma"
          description="Genera il piano: sceglierò dalla tua libreria e, se serve, creerò ricette nuove."
          actionLabel="Genera piano"
          onAction={handleGenerate}
          className="pb-4"
        />
        {screen.current_plan_id !== null && (
          <div className="flex justify-center pb-6">
            <Button
              variant="outline"
              onClick={() => handleRepeat(screen.current_plan_id as string)}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Ripeti questa settimana
            </Button>
          </div>
        )}
      </>
    );
  } else if (isWeekendCurrentWeek) {
    body = (
      <EmptyState
        title="Nessun piano per questa settimana"
        description="Nel weekend si pianifica la settimana che arriva."
        actionLabel="Pianifica la prossima settimana"
        onAction={() => navigate(weekHref(target.week_start))}
      />
    );
  } else {
    body = (
      <EmptyState
        title="Nessun piano per questa settimana"
        description="Per questa settimana non c'è nessun pasto da mostrare."
      />
    );
  }

  const showFooter = plan !== null && !isGenerating && view.editable;

  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold text-ink">Mealy</h1>
        <p className="text-sm text-stone">Cosa mangio oggi?</p>
      </header>

      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-ink">Piano Settimanale</h2>
        {actionButton}
      </div>

      <nav aria-label="Settimane" className="mb-4 flex items-center justify-between gap-1">
        <WeekNavLink
          href={screen.prev_week_start ? weekHref(screen.prev_week_start) : null}
          disabled={isGenerating}
          direction="prev"
          onNavigate={navigate}
        />
        <div className="flex min-w-0 flex-wrap items-center justify-center gap-2">
          <span className="text-sm font-medium text-ink">{range}</span>
          {plan && (
            <Badge variant={plan.status === "active" ? "basil-subtle" : "saffron-subtle"}>
              {plan.status === "active" ? "Confermato" : "Bozza"}
            </Badge>
          )}
        </div>
        <WeekNavLink
          href={screen.next_week_start ? weekHref(screen.next_week_start) : null}
          disabled={isGenerating}
          direction="next"
          onNavigate={navigate}
        />
      </nav>

      {/* Regola: nessun antenato delle card va in opacity, transform o filter a riposo. Le sheet di
          SlotRecipePicker sono fixed e stanno dentro le card: con opacity-60 (navigazione) diventano
          semitrasparenti e la nav in basso (z-40) può coprirne il footer. */}
      <div
        aria-busy={isNavigating}
        className={cn("transition-opacity", isNavigating && "opacity-60")}
      >
        {view.can_repeat && plan && (
          <div className="mb-4">
            <Button
              variant="outline"
              onClick={() => handleRepeat(plan.id)}
              disabled={isGenerating}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Ripeti questo piano
            </Button>
            <p className="mt-1 text-xs text-stone">{`Nella settimana ${targetRange}`}</p>
            {screen.target_plan_status === "draft" && (
              <p className="text-xs text-stone">Sostituirà i pasti non bloccati della bozza.</p>
            )}
          </div>
        )}

        {showSupersededNotice && plan && (
          <div className="mb-4 rounded-xl border border-saffron/40 bg-saffron/10 p-3 text-sm text-ink">
            {plan.status === "draft" && view.action === "regenerate"
              ? "Hai cambiato le impostazioni: rigenera il piano per applicarle."
              : "Le nuove impostazioni varranno dal prossimo piano."}
          </div>
        )}

        {isRecovering && (
          <div className="mb-4 flex flex-col items-start gap-2 rounded-xl border border-stone/30 bg-stone/10 p-3 text-sm text-ink">
            <p>{RECOVERY_WAIT_MESSAGE}</p>
            <Button variant="outline" size="sm" onClick={() => stopRecoveryRef.current?.()}>
              Smetti di aspettare
            </Button>
          </div>
        )}

        {generateError && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-tomato/40 bg-tomato/10 p-3 text-sm text-ink"
          >
            {generateError}
          </div>
        )}

        {body}

        {showFooter && plan && (
          <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 -mx-4 mt-6 bg-paper/95 px-4 py-3 backdrop-blur">
            {plan.status === "draft" ? (
              <Button
                className="h-12 w-full text-base font-semibold shadow-md"
                onClick={() => void handleConfirm()}
                disabled={isConfirming}
              >
                Conferma piano
              </Button>
            ) : (
              plan.shopping_list.exists ? (
                <Link
                  href={`/lista?piano=${plan.id}`}
                  className={cn(
                    buttonVariants({ size: "lg" }),
                    "h-12 w-full gap-2 text-base font-semibold shadow-md"
                  )}
                >
                  <ShoppingBag className="h-5 w-5" aria-hidden="true" />
                  <span>
                    {plan.shopping_list.needs_regeneration ? LIST_STALE_LABEL : LIST_OPEN_LABEL}
                  </span>
                </Link>
              ) : (
                <Button
                  className="h-12 w-full gap-2 text-base font-semibold shadow-md"
                  onClick={() => void handleCreateList()}
                  disabled={isCreatingList}
                >
                  <ShoppingBag className="h-5 w-5" aria-hidden="true" />
                  <span>{isCreatingList ? LIST_CREATING_LABEL : LIST_CREATE_LABEL}</span>
                </Button>
              )
            )}
          </div>
        )}
      </div>

      <RecipeDetailSheet
        recipeId={sheetSlot?.recipe?.id ?? null}
        servings={sheetSlot?.servings ?? 1}
        initialRecipe={sheetSlot?.recipe ?? null}
        onClose={() => setSheetSlotId(null)}
        onRecipePrefsChange={applyRecipePrefs}
        onNotify={setToast}
        blockedMessage={TOAST_BLOCKED_IN_PLAN}
      />

      <Toast
        message={toast}
        onDismiss={() => setToast(null)}
        // Sopra il footer sticky (4rem di tab bar + 4.5rem di footer).
        className={showFooter ? "bottom-[calc(9.5rem+env(safe-area-inset-bottom))]" : undefined}
      />
    </main>
  );
}
