"use client";

import * as React from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { MealCard } from "@/components/cards/meal-card";
import {
  GENERATION_MESSAGES,
  GENERATION_MESSAGE_INTERVAL_MS,
  useRotatingMessage,
} from "@/components/plan/generation-progress";
import { SideDishRow } from "@/components/plan/side-dish-row";
import { SlotRecipePicker } from "@/components/plan/slot-recipe-picker";
import { type RecipePrefChanges } from "@/components/recipes/recipe-detail-sheet";
import { Button } from "@/components/ui/button";
import { recipeChips } from "@/components/sheets/recipe-detail";
import {
  COURSE_LABELS,
  MEAL_TYPE_LABELS,
  SWAP_EXCLUDE_MAX,
  type PlanSlotView,
  type PlanView,
} from "@/lib/domain/types";
import { ApiRequestError, apiErrorMessage } from "@/lib/http/client";
import { requestAddSideDish, requestRemoveSideDish, requestSwapSlot } from "@/lib/plans/client";
import { STALE_PLAN_ERROR_CODES } from "@/lib/plans/errors";
import { formatDayLabel } from "@/lib/plans/format";

export interface PlanSlotCardProps {
  planId: string;
  /** Piatto principale del pasto. */
  slot: PlanSlotView;
  /** Contorno del pasto, se c'è. */
  side?: PlanSlotView | null;
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
  /** Giudizi salvati dal dettaglio aperto nel selettore. */
  onRecipePrefsChange?: (recipeId: string, changed: RecipePrefChanges) => void;
  /** Lo slot o il piano non sono più modificabili: il genitore rilegge il piano. */
  onPlanStale?: () => void;
  /** Messaggio (errore o avviso) da mostrare come toast dal genitore. */
  onError: (message: string) => void;
}

type SlotMode = "idle" | "swapping" | "review";
/** Azione in corso sul contorno (o aggiunta). */
type SideMode = "idle" | "adding" | "swapping" | "removing";
/** Chi ha aperto il selettore: il principale o il contorno. */
type PickerTarget = "main" | "side";
/** Pulsante che riceve il focus dopo un cambio di modalità (la card viene rimontata). */
type FocusTarget =
  | "swap"
  | "keep"
  | "swapAgain"
  | "pick"
  | "sideSwap"
  | "sidePick"
  | "sideAdd"
  | "sideRemove";

const FOCUS_SELECTORS: Record<FocusTarget, string> = {
  // Il pulsante Cambia è di MealCard: aria-label `Cambia <titolo>`; esclude quelli del contorno.
  swap: 'button[aria-label^="Cambia "]:not([data-side-action])',
  keep: '[data-slot-action="keep"]',
  swapAgain: '[data-slot-action="swap-again"]',
  // Scegli è di MealCard; nella revisione la stessa azione è l'icona della riga.
  pick: '[data-slot-action="pick"]',
  sideSwap: '[data-side-action="swap"]',
  sidePick: '[data-side-action="pick"]',
  sideAdd: '[data-side-action="add"]',
  sideRemove: '[data-side-action="remove"]',
};

const MISSING_RECIPE_TITLE = "Ricetta non disponibile";
const SWAP_PENDING_MESSAGES = ["Cerco un'alternativa…", ...GENERATION_MESSAGES] as const;
const SIDE_SEARCH_MESSAGE = "Cerco un contorno…";
const SIDE_REMOVE_MESSAGE = "Tolgo il contorno…";

/** Ricette da escludere: scartate nella sequenza + corrente, senza duplicati, ultime `SWAP_EXCLUDE_MAX`. */
function buildExclude(rejected: readonly string[], currentRecipeId: string | undefined): string[] {
  const all = currentRecipeId ? [...rejected, currentRecipeId] : [...rejected];
  const unique = all.filter((id, index) => all.lastIndexOf(id) === index);
  return unique.slice(-SWAP_EXCLUDE_MAX);
}

const errorCode = (err: unknown): string => (err instanceof ApiRequestError ? err.code : "");

export function PlanSlotCard({
  planId,
  slot,
  side = null,
  editable,
  swappable = true,
  onPlanChange,
  onToggleLock,
  onSelectRecipe,
  onToggleFavorite,
  onRecipePrefsChange,
  onPlanStale,
  onError,
}: PlanSlotCardProps): React.JSX.Element {
  const [mode, setMode] = React.useState<SlotMode>("idle");
  const [rejected, setRejected] = React.useState<string[]>([]);
  const [sideMode, setSideMode] = React.useState<SideMode>("idle");
  const [sideRejected, setSideRejected] = React.useState<string[]>([]);
  const [pickerFor, setPickerFor] = React.useState<PickerTarget | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const pendingFocus = React.useRef<FocusTarget | null>(null);
  const swapping = mode === "swapping";
  // Un'azione in corso su un piatto del pasto blocca le altre sul pasto (FR-4.5).
  const busy = swapping || sideMode !== "idle";
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
      setSideRejected([]);
    }
  }, [slot.locked]);

  const handleSwap = async (): Promise<void> => {
    if (slot.locked || busy) return;
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

  const openPicker = (): void => {
    if (slot.locked || busy) return;
    setPickerFor("main");
  };

  /** Chiusura del selettore senza assegnazione: la card resta com'è, il focus torna su Scegli. */
  const closePicker = (): void => {
    pendingFocus.current = pickerFor === "side" ? "sidePick" : "pick";
    setPickerFor(null);
  };

  /** Ricetta scelta a mano: card in stato normale e sequenza degli scarti azzerata (FR-6.3). */
  const handleAssigned = (plan: PlanView): void => {
    if (pickerFor === "side") {
      pendingFocus.current = "sidePick";
      setPickerFor(null);
      setSideRejected([]);
      onPlanChange(plan);
      return;
    }
    pendingFocus.current = "pick";
    setPickerFor(null);
    setMode("idle");
    setRejected([]);
    onPlanChange(plan);
  };

  // Azioni sul contorno: stesso esito di quelle sul principale, più la rilettura se il piano è cambiato.
  const reportSideError = (err: unknown): void => {
    onError(apiErrorMessage(err));
    if (STALE_PLAN_ERROR_CODES.has(errorCode(err))) onPlanStale?.();
  };

  const canEditDishes = editable && swappable && !slot.locked;

  const handleAddSide = async (): Promise<void> => {
    if (!canEditDishes || busy) return;
    setSideMode("adding");
    try {
      const result = await requestAddSideDish(planId, slot.id, []);
      onPlanChange(result.plan);
      setSideRejected([]);
      pendingFocus.current = "sideSwap";
    } catch (err) {
      reportSideError(err);
      pendingFocus.current = "sideAdd";
    } finally {
      setSideMode("idle");
    }
  };

  const handleSideSwap = async (): Promise<void> => {
    if (!side || !canEditDishes || busy) return;
    const exclude = buildExclude(sideRejected, side.recipe?.id);
    setSideMode("swapping");
    try {
      const result = await requestSwapSlot(planId, side.id, exclude);
      setSideRejected(exclude);
      onPlanChange(result.plan);
      pendingFocus.current = "sideSwap";
    } catch (err) {
      reportSideError(err);
      pendingFocus.current = "sideSwap";
    } finally {
      setSideMode("idle");
    }
  };

  const handleRemoveSide = async (): Promise<void> => {
    if (!side || !canEditDishes || busy) return;
    setSideMode("removing");
    try {
      const result = await requestRemoveSideDish(planId, side.id);
      onPlanChange(result.plan);
      setSideRejected([]);
      pendingFocus.current = "sideAdd";
    } catch (err) {
      reportSideError(err);
      pendingFocus.current = "sideRemove";
    } finally {
      setSideMode("idle");
    }
  };

  const openSidePicker = (): void => {
    if (!side || !canEditDishes || busy) return;
    setPickerFor("side");
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
          size="icon"
          aria-label="Scegli dalla libreria"
          onClick={openPicker}
          data-slot-action="pick"
        >
          <Search className="h-4 w-4 stroke-[2.25]" aria-hidden="true" />
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

  // Riga del contorno, oppure «+ Contorno» sui soli primi e secondi senza contorno.
  let sideContent: React.ReactNode = null;
  if (side) {
    const sideSlot = side;
    sideContent = (
      <SideDishRow
        title={sideSlot.recipe?.title ?? MISSING_RECIPE_TITLE}
        onOpen={sideSlot.recipe ? () => onSelectRecipe(sideSlot) : undefined}
        onSwap={canEditDishes ? () => void handleSideSwap() : undefined}
        onPick={canEditDishes ? openSidePicker : undefined}
        onRemove={canEditDishes ? () => void handleRemoveSide() : undefined}
        disabled={busy || mode === "review"}
        pendingMessage={
          sideMode === "swapping"
            ? SIDE_SEARCH_MESSAGE
            : sideMode === "removing"
              ? SIDE_REMOVE_MESSAGE
              : null
        }
      />
    );
  } else if (canEditDishes && (slot.course === "primo" || slot.course === "secondo")) {
    sideContent =
      sideMode === "adding" ? (
        <p role="status" className="flex min-h-[44px] items-center text-sm font-medium text-stone">
          {SIDE_SEARCH_MESSAGE}
        </p>
      ) : (
        <Button
          variant="ghost"
          className="min-h-[44px] text-basil"
          data-side-action="add"
          aria-label="Aggiungi un contorno"
          disabled={busy || mode === "review"}
          onClick={() => void handleAddSide()}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Contorno
        </Button>
      );
  }

  const isReview = mode === "review";
  const canSwap = editable && swappable;
  // Il giudizio riguarda la ricetta, non il piano: la ★ c'è anche sulle card non modificabili.
  const favoriteRecipeId =
    onToggleFavorite && slot.recipe && slot.recipe.prefs?.blocked !== true ? slot.recipe.id : null;
  const pickerSlot = pickerFor === "side" ? side : pickerFor === "main" ? slot : null;

  return (
    <>
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
          course={
            slot.recipe && slot.recipe.courses.length > 0 ? COURSE_LABELS[slot.course] : undefined
          }
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
          onPick={canSwap ? openPicker : undefined}
          onToggleLock={editable ? () => onToggleLock(slot.id) : undefined}
          onLongPress={editable ? () => onToggleLock(slot.id) : undefined}
          actions={canSwap ? actions : undefined}
          actionsDisabled={busy}
          extra={sideContent ?? undefined}
        />
      </div>
      {/* Fuori dal div con `key`: il passaggio tra base e revisione non rimonta il selettore. */}
      {pickerSlot && (
        <SlotRecipePicker
          planId={planId}
          slot={pickerSlot}
          onClose={closePicker}
          onAssigned={handleAssigned}
          onPlanStale={() => onPlanStale?.()}
          onNotify={onError}
          onRecipePrefsChange={onRecipePrefsChange}
        />
      )}
    </>
  );
}
