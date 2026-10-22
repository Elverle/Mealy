"use client";

import * as React from "react";
import { Ban, Clock, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { recipeChips } from "@/components/sheets/recipe-detail";
import { courseLabel } from "@/lib/domain/courses";
import type { LibraryRecipeCard } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export interface RecipeCardProps {
  recipe: LibraryRecipeCard;
  onOpen: (recipeId: string) => void;
  /** Assente → la ★ non è un comando: sulle preferite resta un'icona non interattiva. */
  onToggleFavorite?: (recipeId: string) => void;
  /** Etichetta accanto al tempo (es. «Già nel piano»). */
  badge?: string;
}

/**
 * Card compatta della Libreria: il corpo apre il dettaglio, la ★ è un pulsante separato.
 * Titolo e badge restano fuori dal pulsante (stretched link): il titolo è un vero `h3` e il
 * pulsante copre l'intera card con uno pseudo-elemento, prendendo il nome dal suo contenuto.
 */
export function RecipeCard({
  recipe,
  onOpen,
  onToggleFavorite,
  badge,
}: RecipeCardProps): React.JSX.Element {
  const chips = recipeChips(recipe);
  const course = courseLabel(recipe.courses);
  const baseId = React.useId();
  const courseId = `${baseId}-course`;
  const metaId = `${baseId}-meta`;
  const badgeId = `${baseId}-badge`;
  const hasMeta = chips.length > 0 || recipe.rating !== null;
  const labelledBy = [
    `${baseId}-time`,
    course !== null ? courseId : null,
    `${baseId}-title`,
    badge !== undefined ? badgeId : null,
    hasMeta ? metaId : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Card className="relative p-4 transition-all hover:border-stone/40 hover:shadow-sm">
      <div className="min-h-[44px] pr-12">
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          <Badge id={`${baseId}-time`} variant="secondary" className="gap-1 text-[11px]">
            <Clock className="h-3 w-3 text-stone" aria-hidden="true" />
            <span className="tabular-nums">{recipe.prep_minutes} min</span>
          </Badge>
          {course !== null && (
            <Badge id={courseId} variant="basil-subtle" className="text-[11px]">
              {course}
            </Badge>
          )}
          {badge !== undefined && (
            <Badge id={badgeId} variant="saffron-subtle" className="text-[11px]">
              {badge}
            </Badge>
          )}
        </div>

        <h3
          id={`${baseId}-title`}
          className="font-display text-base font-bold text-ink line-clamp-2"
        >
          {recipe.title}
        </h3>
        {hasMeta && (
          <div
            id={metaId}
            className="mt-3 flex items-center justify-between gap-2 border-t border-stone/15 pt-2 text-xs"
          >
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
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onOpen(recipe.id)}
        aria-labelledby={labelledBy}
        className="cursor-pointer after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-basil"
      />
      {recipe.blocked ? (
        <span className="absolute right-3 top-3 z-10 flex items-center gap-1 text-[11px] font-semibold text-tomato">
          <Ban className="h-3 w-3" aria-hidden="true" /> Bloccata
        </span>
      ) : onToggleFavorite ? (
        <button
          type="button"
          onClick={() => onToggleFavorite(recipe.id)}
          aria-pressed={recipe.favorite}
          aria-label={
            recipe.favorite
              ? `Rimuovi ${recipe.title} dai preferiti`
              : `Aggiungi ${recipe.title} ai preferiti`
          }
          className="absolute right-1 top-1 z-10 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-stone transition-colors hover:text-saffron focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-basil"
        >
          <Star
            className={cn("h-4 w-4", recipe.favorite ? "fill-saffron text-saffron" : "text-stone")}
            aria-hidden="true"
          />
        </button>
      ) : (
        recipe.favorite && (
          <span
            role="img"
            aria-label="Preferita"
            className="absolute right-3 top-3 z-10 text-saffron"
          >
            <Star className="h-4 w-4 fill-saffron" aria-hidden="true" />
          </span>
        )
      )}
    </Card>
  );
}
