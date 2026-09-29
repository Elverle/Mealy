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
import { RecipeSheet } from "@/components/sheets/recipe-sheet";
import { toRecipeDetail } from "@/components/sheets/recipe-detail";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  GeneratePlanResult,
  PlanScreenView,
  PlanSlotView,
  PlanView,
} from "@/lib/domain/types";
import {
  PlanRequestError,
  fetchPlanScreen,
  requestConfirmPlan,
  requestGeneratePlan,
  requestRepeatPlan,
  requestSlotLock,
} from "@/lib/plans/client";
import { formatDayLabel, formatWeekRange } from "@/lib/plans/format";

export interface PlanScreenProps {
  initialScreen: PlanScreenView;
}

type TargetRequestKind = "generate" | "repeat";

const NETWORK_ERROR_CODE = "network_error";
const FALLBACK_ERROR_MESSAGE = "Qualcosa è andato storto. Riprova.";
const GENERATION_SKELETON_CARDS = 4;

const TOAST_GENERATED = "Piano generato";
const TOAST_GENERATED_FALLBACK = "Piano generato con le ricette della libreria.";
const TOAST_REPEATED = "Piano ripetuto";
const TOAST_CONFIRMED = "Piano confermato";

// Quando dopo Genera/Ripeti si passa alla settimana obiettivo la pagina viene
// rimontata (nuova `key`): il toast attraversa il rimontaggio tramite questo slot.
let pendingToast: string | null = null;

/** Scarta il toast in attesa di rimontaggio (usato dai test per isolarsi). */
export function discardPendingPlanToast(): void {
  pendingToast = null;
}

function errorMessage(err: unknown): string {
  return err instanceof PlanRequestError ? err.message : FALLBACK_ERROR_MESSAGE;
}

function weekHref(weekStart: string): string {
  return `/?settimana=${weekStart}`;
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
  direction: "prev" | "next";
  onNavigate: (href: string) => void;
}

const NAV_LINK_CLASS =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink transition-colors";

function WeekNavLink({ href, direction, onNavigate }: WeekNavLinkProps): React.JSX.Element {
  const label = direction === "prev" ? "Settimana precedente" : "Settimana successiva";
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;

  if (href === null) {
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
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [generateError, setGenerateError] = React.useState<string | null>(null);
  const [isConfirming, setIsConfirming] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  const [sheetSlotId, setSheetSlotId] = React.useState<string | null>(null);

  // Recupera il toast lasciato dalla pagina che ha navigato verso la settimana obiettivo.
  React.useEffect(() => {
    if (pendingToast !== null) {
      setToast(pendingToast);
      pendingToast = null;
    }
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
  const sheetRecipe = React.useMemo(
    () => (sheetSlot?.recipe ? toRecipeDetail(sheetSlot.recipe, sheetSlot.servings) : null),
    [sheetSlot]
  );

  /** Adotta l'esito di Genera/Rigenera/Ripeti: cambia settimana o aggiorna lo stato. */
  const adoptTargetScreen = (next: PlanScreenView, message: string): void => {
    setToast(message);
    if (isTargetShown) {
      setScreen(next);
      return;
    }
    pendingToast = message;
    navigate(weekHref(target.week_start), "replace");
  };

  /** Dopo un errore di rete il server può aver comunque salvato il piano (R1). */
  const recoverTargetScreen = async (
    startedAtMs: number,
    baselineGeneratedAt: string | null | undefined
  ): Promise<PlanScreenView | null> => {
    try {
      const fresh = await fetchPlanScreen(target.week_start);
      const freshPlan = fresh.view.plan;
      if (!freshPlan) return null;
      if (baselineGeneratedAt === null) return fresh;
      const thresholdMs =
        baselineGeneratedAt === undefined ? startedAtMs : Date.parse(baselineGeneratedAt);
      return Date.parse(freshPlan.generated_at) > thresholdMs ? fresh : null;
    } catch {
      // Recupero impossibile: si mostra l'errore originale.
      return null;
    }
  };

  const runTargetRequest = async (
    kind: TargetRequestKind,
    request: () => Promise<GeneratePlanResult>
  ): Promise<void> => {
    setIsGenerating(true);
    setGenerateError(null);
    const startedAtMs = Date.now();
    // null: nessun piano prima; undefined: piano esistente ma non visibile in questa settimana.
    const baselineGeneratedAt = isTargetShown
      ? (screen.view.plan?.generated_at ?? null)
      : screen.target_plan_status === null
        ? null
        : undefined;
    const successMessage = kind === "generate" ? TOAST_GENERATED : TOAST_REPEATED;
    try {
      const result = await request();
      const message =
        kind === "generate" && result.generation.failed ? TOAST_GENERATED_FALLBACK : successMessage;
      adoptTargetScreen(result.screen, message);
    } catch (err) {
      const recovered =
        err instanceof PlanRequestError && err.code === NETWORK_ERROR_CODE
          ? await recoverTargetScreen(startedAtMs, baselineGeneratedAt)
          : null;
      if (recovered) {
        adoptTargetScreen(recovered, successMessage);
      } else if (kind === "generate") {
        setGenerateError(errorMessage(err));
      } else {
        setToast(errorMessage(err));
      }
    } finally {
      setIsGenerating(false);
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
      setToast(errorMessage(err));
    } finally {
      setIsConfirming(false);
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
      setScreen((prev) => withPlan(prev, result.plan));
    } catch (err) {
      setSlotLocked(slotId, !nextLocked);
      setToast(errorMessage(err));
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
                onPlanChange={(next) => setScreen((prev) => withPlan(prev, next))}
                onToggleLock={(slotId) => void handleToggleLock(slotId)}
                onSelectRecipe={(selected) => setSheetSlotId(selected.id)}
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
    <main className="mx-auto min-h-screen max-w-xl px-4 py-6">
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
          direction="next"
          onNavigate={navigate}
        />
      </nav>

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
              <Link
                href={`/lista?piano=${plan.id}`}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-12 w-full gap-2 text-base font-semibold shadow-md"
                )}
              >
                <ShoppingBag className="h-5 w-5" aria-hidden="true" />
                <span>Crea lista della spesa</span>
              </Link>
            )}
          </div>
        )}
      </div>

      <RecipeSheet
        recipe={sheetRecipe}
        isOpen={sheetSlot !== null}
        onClose={() => setSheetSlotId(null)}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </main>
  );
}
