// Regole pure delle preferenze sulle ricette. Nessuna dipendenza da DB, LLM o framework.

import { recipeIngredientNames } from './library';
import type { Recipe, RecipePref, UpdateRecipePrefRequest } from './types';

export interface RecipePrefFields {
  rating: number | null;
  favorite: boolean;
  blocked: boolean;
}

/** Preferenze di una ricetta senza riga in recipe_prefs. */
export function defaultRecipePref(recipeId: string): RecipePref {
  return {
    recipe_id: recipeId,
    rating: null,
    favorite: false,
    blocked: false,
    times_used: 0,
    last_used_at: null,
  };
}

/** Applica un aggiornamento parziale. Bloccare toglie dalle preferite. */
export function applyRecipePrefPatch(
  current: Pick<RecipePref, 'rating' | 'favorite' | 'blocked'> | null,
  patch: UpdateRecipePrefRequest
): RecipePrefFields {
  const rating = patch.rating !== undefined ? patch.rating : (current?.rating ?? null);
  const blocked = patch.blocked ?? current?.blocked ?? false;
  const favorite = blocked ? false : (patch.favorite ?? current?.favorite ?? false);
  return { rating, favorite, blocked };
}

/** Per ogni nome canonico, quante ricette NON bloccate lo contengono (una ricetta conta una volta). */
export function countRecipesByIngredient(recipes: readonly Recipe[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const recipe of recipes) {
    if (recipe.prefs?.blocked === true) continue;
    for (const name of recipeIngredientNames(recipe)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}
