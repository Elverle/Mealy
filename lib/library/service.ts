// Solo lato server: importa il DB. I componenti client usano client.ts.
// Legge l'intera libreria a ogni chiamata (≈ 60 ms a 300 ricette su desktop): se serve, il conteggio per un solo ingrediente si fa in SQL su recipe_ingredients_canonical_name_idx.

import { db } from '@/lib/db';
import { loadHousehold } from '@/lib/db/repositories/household-repo';
import { listIngredientPrefRows } from '@/lib/db/repositories/ingredient-pref-repo';
import { listRecipes } from '@/lib/db/repositories/recipe-repo';
import { compareLibraryCards, filterLibraryCards, recipeIngredientNames, toLibraryCard } from '@/lib/domain/library';
import { countRecipesByIngredient } from '@/lib/domain/prefs';
import type {
  IngredientPref,
  LibraryFilter,
  LibraryRecipeCard,
  LibraryView,
  RecipeDetailView,
} from '@/lib/domain/types';

/** Tutte le card della libreria dell'household (bloccate comprese), già ordinate. */
export async function listLibraryCards(householdId?: string): Promise<LibraryRecipeCard[]> {
  const household = await loadHousehold(householdId);
  const recipes = await listRecipes({ household_id: household.id });
  return recipes.map(toLibraryCard).sort(compareLibraryCards);
}

/** Card filtrate e ordinate, più il totale senza filtri. */
export async function listLibrary(filter: LibraryFilter, householdId?: string): Promise<LibraryView> {
  const cards = await listLibraryCards(householdId);
  return { recipes: filterLibraryCards(cards, filter), total: cards.length };
}

/** Dettaglio di una ricetta dell'household; null se non esiste o è di un altro household. */
export async function getRecipeDetail(
  recipeId: string,
  householdId?: string
): Promise<RecipeDetailView | null> {
  const household = await loadHousehold(householdId);
  const library = await listRecipes({ household_id: household.id });
  const recipe = library.find((r) => r.id === recipeId);
  if (!recipe) return null;

  const rows = await listIngredientPrefRows(db, household.id);
  const prefByName = new Map<string, IngredientPref>(rows.map((row) => [row.canonical_name, row.pref]));
  const counts = countRecipesByIngredient(library);

  const ingredients = recipeIngredientNames(recipe).map((name) => ({
    canonical_name: name,
    pref: prefByName.get(name) ?? null,
    recipes_count: counts.get(name) ?? 0,
  }));
  return { recipe, ingredients };
}
