"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { MealCard } from "@/components/cards/meal-card";
import {
  GENERATION_MESSAGES,
  GENERATION_MESSAGE_INTERVAL_MS,
  useRotatingMessage,
} from "@/components/plan/generation-progress";
import { Button } from "@/components/ui/button";
import { recipeChips } from "@/components/sheets/recipe-detail";
import {
  MEAL_TYPE_LABELS,
  SWAP_EXCLUDE_MAX,
  type PlanSlotView,
  type PlanView,
} from "@/lib/domain/types";
import { apiErrorMessage } from "@/lib/http/client";
import { requestSwapSlot } from "@/lib/plans/client";
import { formatDayLabel } from "@/lib/plans/format";

export interface PlanSlotCardProps {
  planId: string;
  slot: PlanSlotView;
  /** false → niente Cambia, lucchetto e long-press (card di sola lettura). */
  editable: boolean;
  /** false → niente Cambia, ma il blocco resta (pasto di un giorno già passato). Default: true. */
  swappable?: boolean;
  /** Dopo uno swap riuscito. */
  onPlanChange: (plan: PlanView) => void;
  onToggleLock: (slotId: string) => void;
  onSelectRecipe: (slot: PlanSlotView) => void;
  /** Alterna la preferita della ricetta dello slot. Assente → nessuna ★. */
  onToggleFavorite?: (recipeId: string) => void;
  /** Messaggio da mostrare come toast dal genitore. */
  onError: (message: string) => void;
}

type SlotMode = "idle" | "swapping" | "review";
/** Pulsante che riceve il focus dopo un cambio di modalità (la card viene rimontata). */
type FocusTarget = "swap" | "keep" | "swapAgain";

const FOCUS_SELECTORS: Record<FocusTarget, string> = {
  // Il pulsante Cambia è di MealCard: aria-label `Cambia <titolo>`.
  swap: 'button[aria-label^="Cambia "]',
  keep: '[data-slot-action="keep"]',
  swapAgain: '[data-slot-action="swap-again"]',
};

const MISSING_RECIPE_TITLE = "Ricetta non disponibile";
const SWAP_PENDING_MESSAGES = ["Cerco un'alternativa…", ...GENERATION_MESSAGES] as const;

/** Ricette da escludere: scartate nella sequenza + corrente, senza duplicati, ultime `SWAP_EXCLUDE_MAX`. */
function buildExclude(rejected: readonly string[], currentRecipeId: string | undefined): string[] {
  const all = currentRecipeId ? [...rejected, currentRecipeId] : [...rejected];
  const unique = all.filter((id, index) => all.lastIndexOf(id) === index);
  return unique.slice(-SWAP_EXCLUDE_MAX);
}

export function PlanSlotCard({
  planId,
  slot,
  editable,
  swappable = true,
  onPlanChange,
  onToggleLock,
  onSelectRecipe,
  onToggleFavorite,
  onError,
}: PlanSlotCardProps): React.JSX.Element {
  const [mode, setMode] = React.useState<SlotMode>("idle");
  const [rejected, setRejected] = React.useState<string[]>([]);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const pendingFocus = React.useRef<FocusTarget | null>(null);
  const swapping = mode === "swapping";
  const pendingMessage = useRotatingMessage(
    SWAP_PENDING_MESSAGES,
    GENERATION_MESSAGE_INTERVAL_MS,
    swapping
  );

  // A ogni passo dello swap il pulsante premuto sparisce: il focus va al passo successivo,
  // ma solo se l'utente non l'ha spostato altrove nel frattempo.
  React.useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    const wrapper = wrapperRef.current;
    const active = document.activeElement;
    if (!wrapper || (active && active !== document.body && !wrapper.contains(active))) return;
    wrapper.querySelector<HTMLElement>(FOCUS_SELECTORS[target])?.focus();
  });

  // Se lo slot viene bloccato durante la revisione, la sequenza di swap termina.
  React.useEffect(() => {
    if (slot.locked) {
      setMode((current) => (current === "review" ? "idle" : current));
      setRejected([]);
    }
  }, [slot.locked]);

  const handleSwap = async (): Promise<void> => {
    if (slot.locked || swapping) return;
    const previousMode = mode;
    const exclude = buildExclude(rejected, slot.recipe?.id);
    setMode("swapping");
    try {
      const result = await requestSwapSlot(planId, slot.id, exclude);
      setRejected(exclude);
      onPlanChange(result.plan);
      pendingFocus.current = "keep";
      setMode("review");
    } catch (err) {
      onError(apiErrorMessage(err));
      pendingFocus.current = previousMode === "review" ? "swapAgain" : "swap";
      setMode(previousMode);
    }
  };

  const handleKeep = (): void => {
    pendingFocus.current = "swap";
    setMode("idle");
    setRejected([]);
  };

  let actions: React.ReactNode;
  if (swapping) {
    actions = (
      <p role="status" className="flex min-h-[44px] items-center text-sm font-medium text-stone">
        {pendingMessage}
      </p>
    );
  } else if (mode === "review") {
    actions = (
      <div className="flex w-full items-center justify-between gap-2">
        <Button
          variant="outline"
          className="min-h-[44px] text-basil"
          onClick={handleKeep}
          data-slot-action="keep"
        >
          Tieni
        </Button>
        <Button
          variant="ghost"
          className="min-h-[44px] text-tomato hover:bg-tomato/10"
          onClick={() => void handleSwap()}
          data-slot-action="swap-again"
        >
          <RefreshCw className="h-4 w-4 stroke-[2.25]" aria-hidden="true" />
          Cambia ancora
        </Button>
      </div>
    );
  }

  const isReview = mode === "review";
  const canSwap = editable && swappable;
  // Il giudizio riguarda la ricetta, non il piano: la ★ c'è anche sulle card non modificabili.
  const favoriteRecipeId =
    onToggleFavorite && slot.recipe && slot.recipe.prefs?.blocked !== true ? slot.recipe.id : null;

  return (
    <div
      ref={wrapperRef}
      key={isReview ? `review-${slot.recipe?.id ?? "none"}` : "base"}
      className={isReview ? "animate-meal-flip" : undefined}
    >
      <MealCard
        id={slot.id}
        day={formatDayLabel(slot.day).split(" ")[0]}
        mealType={MEAL_TYPE_LABELS[slot.meal]}
        title={slot.recipe?.title ?? MISSING_RECIPE_TITLE}
        prepTimeMinutes={slot.recipe?.prep_minutes}
        tags={slot.recipe ? recipeChips(slot.recipe) : []}
        isLocked={slot.locked}
        isFavorite={slot.recipe?.prefs?.favorite ?? false}
        onToggleFavorite={
          favoriteRecipeId !== null && onToggleFavorite
            ? () => onToggleFavorite(favoriteRecipeId)
            : undefined
        }
        onSelect={slot.recipe ? () => onSelectRecipe(slot) : undefined}
        onSwap={canSwap ? () => void handleSwap() : undefined}
        onToggleLock={editable ? () => onToggleLock(slot.id) : undefined}
        onLongPress={editable ? () => onToggleLock(slot.id) : undefined}
        actions={canSwap ? actions : undefined}
      />
    </div>
  );
}
