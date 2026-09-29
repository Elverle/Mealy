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
import { PlanRequestError, requestSwapSlot } from "@/lib/plans/client";
import { formatDayLabel } from "@/lib/plans/format";

export interface PlanSlotCardProps {
  planId: string;
  slot: PlanSlotView;
  /** false → niente Cambia, lucchetto e long-press (card di sola lettura). */
  editable: boolean;
  /** Dopo uno swap riuscito. */
  onPlanChange: (plan: PlanView) => void;
  onToggleLock: (slotId: string) => void;
  onSelectRecipe: (slot: PlanSlotView) => void;
  /** Messaggio da mostrare come toast dal genitore. */
  onError: (message: string) => void;
}

type SlotMode = "idle" | "swapping" | "review";

const MISSING_RECIPE_TITLE = "Ricetta non disponibile";
const SWAP_PENDING_MESSAGES = ["Cerco un'alternativa…", ...GENERATION_MESSAGES] as const;
const SWAP_FALLBACK_ERROR = "Qualcosa è andato storto. Riprova.";

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
  onPlanChange,
  onToggleLock,
  onSelectRecipe,
  onError,
}: PlanSlotCardProps): React.JSX.Element {
  const [mode, setMode] = React.useState<SlotMode>("idle");
  const [rejected, setRejected] = React.useState<string[]>([]);
  const swapping = mode === "swapping";
  const pendingMessage = useRotatingMessage(
    SWAP_PENDING_MESSAGES,
    GENERATION_MESSAGE_INTERVAL_MS,
    swapping
  );

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
      setMode("review");
    } catch (err) {
      onError(err instanceof PlanRequestError ? err.message : SWAP_FALLBACK_ERROR);
      setMode(previousMode);
    }
  };

  const handleKeep = (): void => {
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
        <Button variant="outline" className="min-h-[44px] text-basil" onClick={handleKeep}>
          Tieni
        </Button>
        <Button
          variant="ghost"
          className="min-h-[44px] text-tomato hover:bg-tomato/10"
          onClick={() => void handleSwap()}
        >
          <RefreshCw className="h-4 w-4 stroke-[2.25]" aria-hidden="true" />
          Cambia ancora
        </Button>
      </div>
    );
  }

  const isReview = mode === "review";

  return (
    <div
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
        onSelect={slot.recipe ? () => onSelectRecipe(slot) : undefined}
        onSwap={editable ? () => void handleSwap() : undefined}
        onToggleLock={editable ? () => onToggleLock(slot.id) : undefined}
        onLongPress={editable ? () => onToggleLock(slot.id) : undefined}
        actions={editable ? actions : undefined}
      />
    </div>
  );
}
