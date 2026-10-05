"use client";

import * as React from "react";
import { Ban, Clock, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { recipeChips } from "@/components/sheets/recipe-detail";
import type { LibraryRecipeCard } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export interface RecipeCardProps {
  recipe: LibraryRecipeCard;
  onOpen: (recipeId: string) => void;
  onToggleFavorite: (recipeId: string) => void;
}

/** Card compatta della Libreria: il corpo apre il dettaglio, la ★ è un pulsante separato. */
export function RecipeCard({ recipe, onOpen, onToggleFavorite }: RecipeCardProps): React.JSX.Element {
  const chips = recipeChips(recipe);
  return (
    <Card className="relative p-4 transition-all hover:border-stone/40 hover:shadow-sm">
      <button
        type="button"
        onClick={() => onOpen(recipe.id)}
        className="block min-h-[44px] w-full cursor-pointer rounded-lg pr-12 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil"
      >
        <Badge variant="secondary" className="mb-1.5 gap-1 text-[11px]">
          <Clock className="h-3 w-3 text-stone" aria-hidden="true" />
          <span className="tabular-nums">{recipe.prep_minutes} min</span>
        </Badge>
        <h3 className="font-display text-base font-bold text-ink line-clamp-2">{recipe.title}</h3>
        {(chips.length > 0 || recipe.rating !== null) && (
          <span className="mt-3 flex items-center justify-between gap-2 border-t border-stone/15 pt-2 text-xs">
            <span className="flex flex-wrap items-center gap-1 text-stone">
              {chips.map((chip) => (
                <span key={chip} className="rounded bg-stone/10 px-1.5 py-0.5">
                  {chip}
                </span>
              ))}
            </span>
            {recipe.rating !== null && (
              <span
                role="img"
                aria-label={`Voto ${recipe.rating} su 5`}
                className="flex items-center gap-0.5 font-bold text-saffron"
              >
                <Star className="h-3.5 w-3.5 fill-saffron" aria-hidden="true" />
                <span aria-hidden="true">{recipe.rating}</span>
              </span>
            )}
          </span>
        )}
      </button>
      {recipe.blocked ? (
        <span className="absolute right-3 top-3 flex items-center gap-1 text-[11px] font-semibold text-tomato">
          <Ban className="h-3 w-3" aria-hidden="true" /> Bloccata
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onToggleFavorite(recipe.id)}
          aria-pressed={recipe.favorite}
          aria-label={
            recipe.favorite
              ? `Rimuovi ${recipe.title} dai preferiti`
              : `Aggiungi ${recipe.title} ai preferiti`
          }
          className="absolute right-1 top-1 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-stone transition-colors hover:text-saffron focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil"
        >
          <Star
            className={cn("h-4 w-4", recipe.favorite ? "fill-saffron text-saffron" : "text-stone")}
            aria-hidden="true"
          />
        </button>
      )}
    </Card>
  );
}
