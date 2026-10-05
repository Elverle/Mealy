"use client";

import * as React from "react";
import {
  Clock,
  Users,
  Star,
  Ban,
  ThumbsUp,
  ThumbsDown,
  Plus,
  Minus,
  AlertTriangle,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface RecipeIngredient {
  id: string;
  name: string;
  amount: number;
  unit: string;
  preference?: "liked" | "disliked" | null;
  /** Nome canonico normalizzato: se presente, titola la conferma di scarto. */
  canonicalName?: string;
  /** Ricette non bloccate in libreria che lo contengono: se presente, la conferma di scarto lo mostra. */
  recipesCount?: number;
}

export interface RecipeDetail {
  id: string;
  title: string;
  description?: string;
  prepTimeMinutes: number;
  servings: number;
  tags?: string[];
  ingredients: RecipeIngredient[];
  steps: string[];
  rating?: number; // 1-5
  isFavorite?: boolean;
  isBlocked?: boolean;
}

export interface RecipeSheetProps {
  recipe: RecipeDetail | null;
  isOpen: boolean;
  onClose: () => void;
  onToggleFavorite?: (id: string) => void;
  onToggleBlock?: (id: string) => void;
  onRate?: (id: string, rating: number) => void;
  onIngredientPreference?: (
    ingredientId: string,
    preference: "liked" | "disliked" | null
  ) => void;
  /** Ricetta in caricamento (recipe null): mostra lo scheletro invece di niente. */
  isLoading?: boolean;
  /** Disabilita voto, Preferita e blocco (salvataggio in corso). */
  actionsDisabled?: boolean;
  /** Disabilita 👍/👎 e la conferma di esclusione (salvataggio in corso). */
  ingredientsDisabled?: boolean;
}

const SKELETON_ROWS = [0, 1, 2];

/** Seconda riga della conferma di scarto, in base all'impatto noto. */
function dislikeImpactText(recipesCount: number | undefined): string {
  if (recipesCount === undefined) {
    return "Escluderà le ricette contenenti questo ingrediente dai prossimi piani.";
  }
  if (recipesCount === 0) {
    return "Nessuna ricetta in libreria lo contiene: non lo userò in quelle nuove.";
  }
  if (recipesCount === 1) return "Escluderà 1 ricetta dai prossimi piani.";
  return `Escluderà ${recipesCount} ricette dai prossimi piani.`;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil";

export function RecipeSheet({
  recipe,
  isOpen,
  onClose,
  onToggleFavorite,
  onToggleBlock,
  onRate,
  onIngredientPreference,
  isLoading = false,
  actionsDisabled = false,
  ingredientsDisabled = false,
}: RecipeSheetProps) {
  const [servings, setServings] = React.useState(recipe?.servings || 4);
  const [pendingDislikeIngredient, setPendingDislikeIngredient] =
    React.useState<RecipeIngredient | null>(null);

  // Sync servings only when the recipe (id) or its base servings change: a new object for the
  // same recipe (e.g. updated preferences) must not reset the servings chosen by the user.
  const recipeId = recipe?.id;
  const baseServingsProp = recipe?.servings;
  React.useEffect(() => {
    if (recipeId === undefined || baseServingsProp === undefined) return;
    setServings(baseServingsProp);
    setPendingDislikeIngredient(null);
  }, [recipeId, baseServingsProp]);

  if (!recipe) {
    if (!isLoading) return null;
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="bottom"
          className="max-h-[92vh] overflow-y-auto px-4 pb-8 pt-6 sm:px-6"
        >
          <SheetHeader className="mb-4">
            <SheetTitle className="text-2xl mt-2">Apro la ricetta…</SheetTitle>
          </SheetHeader>
          <div role="status" aria-label="Caricamento della ricetta" className="space-y-3">
            {SKELETON_ROWS.map((row) => (
              <div
                key={row}
                className="h-12 rounded-xl bg-stone/15 animate-pulse motion-reduce:animate-none"
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  const hasActionBar = Boolean(onRate || onToggleFavorite || onToggleBlock);
  const baseServings = recipe.servings || 1;
  const scale = servings / baseServings;

  const formatAmount = (baseAmount: number) => {
    const scaled = baseAmount * scale;
    if (scaled === 0) return "";
    return scaled % 1 === 0 ? scaled.toString() : scaled.toFixed(1);
  };

  const handleDecreaseServings = () => {
    if (servings > 1) {
      setServings((s) => s - 1);
    }
  };

  const handleIncreaseServings = () => {
    setServings((s) => s + 1);
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] overflow-y-auto px-4 pb-8 pt-6 sm:px-6"
      >
        <SheetHeader className="mb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1 text-xs">
              <Clock className="h-3 w-3 text-stone" />
              <span className="tabular-nums">{recipe.prepTimeMinutes} min</span>
            </Badge>
            {recipe.tags?.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">
                {tag}
              </Badge>
            ))}
            {recipe.isBlocked && (
              <Badge variant="destructive" className="gap-1 text-xs">
                <Ban className="h-3 w-3" /> Bloccata
              </Badge>
            )}
          </div>

          <SheetTitle className="text-2xl mt-2">{recipe.title}</SheetTitle>
          {recipe.description && (
            <SheetDescription className="text-sm mt-1">
              {recipe.description}
            </SheetDescription>
          )}
        </SheetHeader>

        {/* Portion selector */}
        <div className="my-4 flex items-center justify-between rounded-xl bg-white p-3 border border-stone/20">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Users className="h-4 w-4 text-stone" />
            <span>Porzioni:</span>
            <span
              data-testid="recipe-servings"
              className="font-bold text-basil tabular-nums text-base"
            >
              {servings}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleDecreaseServings}
              disabled={servings <= 1}
              aria-label="Diminuisci porzioni"
              className={cn("flex h-11 w-11 items-center justify-center rounded-lg border border-stone/20 text-ink transition-colors hover:bg-stone/10 disabled:opacity-30 disabled:pointer-events-none cursor-pointer", FOCUS_RING)}
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleIncreaseServings}
              aria-label="Aumenta porzioni"
              className={cn("flex h-11 w-11 items-center justify-center rounded-lg border border-stone/20 text-ink transition-colors hover:bg-stone/10 cursor-pointer", FOCUS_RING)}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Confirmation banner for disliking ingredient */}
        {pendingDislikeIngredient && (
          <div className="my-3 rounded-xl border border-tomato/30 bg-tomato/10 p-3.5 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-tomato shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-tomato">
                  {`Scartare ${pendingDislikeIngredient.canonicalName ?? pendingDislikeIngredient.name}?`}
                </p>
                <p className="text-xs text-stone mt-0.5">
                  {dislikeImpactText(pendingDislikeIngredient.recipesCount)}
                </p>
                <div className="mt-2.5 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={ingredientsDisabled}
                    className="disabled:pointer-events-none disabled:opacity-40"
                    onClick={() => {
                      onIngredientPreference?.(
                        pendingDislikeIngredient.id,
                        "disliked"
                      );
                      setPendingDislikeIngredient(null);
                    }}
                  >
                    Conferma esclusione
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPendingDislikeIngredient(null)}
                  >
                    Annulla
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Ingredients list */}
        <div className="my-4">
          <h4 className="font-display text-base font-bold text-ink mb-2">
            Ingredienti
          </h4>
          <ul className="divide-y divide-stone/15 rounded-xl border border-stone/20 bg-white">
            {recipe.ingredients.map((ing) => {
              const formattedAmt = formatAmount(ing.amount);
              return (
                <li
                  key={ing.id}
                  className="flex min-h-[44px] items-center justify-between px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2 flex-1 mr-2">
                    <span className="font-semibold text-ink">
                      {ing.name}
                    </span>
                    {(formattedAmt || ing.unit) && (
                      <span className="text-xs text-stone tabular-nums">
                        ({formattedAmt} {ing.unit})
                      </span>
                    )}
                  </div>

                  {/* Preference thumbs — shown only when handler is wired */}
                  {onIngredientPreference && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const next = ing.preference === "liked" ? null : "liked";
                        onIngredientPreference?.(ing.id, next);
                      }}
                      aria-label={`Preferisci ${ing.name}`}
                      aria-pressed={ing.preference === "liked"}
                      disabled={ingredientsDisabled}
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-basil/15 cursor-pointer disabled:pointer-events-none disabled:opacity-40",
                        FOCUS_RING,
                        ing.preference === "liked"
                          ? "text-basil bg-basil/10"
                          : "text-stone hover:text-basil"
                      )}
                    >
                      <ThumbsUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (ing.preference === "disliked") {
                          onIngredientPreference?.(ing.id, null);
                        } else {
                          setPendingDislikeIngredient(ing);
                        }
                      }}
                      aria-label={`Scarta ${ing.name}`}
                      aria-pressed={ing.preference === "disliked"}
                      disabled={ingredientsDisabled}
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-lg transition-colors hover:bg-tomato/15 cursor-pointer disabled:pointer-events-none disabled:opacity-40",
                        FOCUS_RING,
                        ing.preference === "disliked"
                          ? "text-tomato bg-tomato/10"
                          : "text-stone hover:text-tomato"
                      )}
                    >
                      <ThumbsDown className="h-4 w-4" />
                    </button>
                  </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Numbered Steps */}
        <div className="my-4">
          <h4 className="font-display text-base font-bold text-ink mb-2">
            Preparazione
          </h4>
          <ol className="space-y-3">
            {recipe.steps.map((step, idx) => (
              <li
                key={idx}
                className="flex items-start gap-3 rounded-xl border border-stone/15 bg-white p-3 text-sm text-ink"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-basil text-xs font-bold text-paper tabular-nums">
                  {idx + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Action bar (Rating, Favorite, Block) — only when a handler is wired */}
        {hasActionBar && (
          <div className="mt-6 border-t border-stone/20 pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {/* 1-5 Rating stars */}
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-stone mr-1">Voto:</span>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => onRate?.(recipe.id, star)}
                    aria-label={`Vota ${star} stelle`}
                    aria-pressed={recipe.rating === star}
                    disabled={actionsDisabled}
                    className={cn(
                      "flex h-11 w-11 items-center justify-center rounded-lg text-stone transition-colors hover:text-saffron hover:bg-saffron/15 cursor-pointer disabled:pointer-events-none disabled:opacity-40",
                      FOCUS_RING
                    )}
                  >
                    <Star
                      className={cn(
                        "h-5 w-5",
                        (recipe.rating || 0) >= star
                          ? "fill-saffron text-saffron"
                          : "text-stone"
                      )}
                    />
                  </button>
                ))}
              </div>

              {/* Favorite & Block buttons */}
              <div className="flex items-center gap-2">
                <Button
                  variant={recipe.isFavorite ? "default" : "outline"}
                  className={cn(
                    "flex-1 sm:flex-initial",
                    recipe.isFavorite && "bg-saffron text-ink hover:bg-saffron/90"
                  )}
                  aria-pressed={Boolean(recipe.isFavorite)}
                  disabled={actionsDisabled || Boolean(recipe.isBlocked)}
                  onClick={() => onToggleFavorite?.(recipe.id)}
                >
                  <Star
                    className={cn(
                      "h-4 w-4",
                      recipe.isFavorite ? "fill-ink text-ink" : "text-stone"
                    )}
                  />
                  <span>Preferita</span>
                </Button>

                <Button
                  variant={recipe.isBlocked ? "destructive" : "outline"}
                  className="flex-1 sm:flex-initial"
                  disabled={actionsDisabled}
                  onClick={() => onToggleBlock?.(recipe.id)}
                >
                  <Ban className="h-4 w-4" />
                  <span>
                    {recipe.isBlocked ? "Sblocca ricetta" : "Non proporre più"}
                  </span>
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
