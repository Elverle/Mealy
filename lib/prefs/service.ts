// Solo lato server: importa il DB. I componenti client usano client.ts.
// Legge l'intera libreria a ogni chiamata (≈ 60 ms a 300 ricette su desktop): se serve, il conteggio per un solo ingrediente si fa in SQL su recipe_ingredients_canonical_name_idx.

import { db } from '@/lib/db';
import { loadHousehold } from '@/lib/db/repositories/household-repo';
import {
  deleteIngredientPref,
  listIngredientPrefRows,
  upsertIngredientPref,
} from '@/lib/db/repositories/ingredient-pref-repo';
import {
  listRecipes,
  lockRecipePref,
  recipeBelongsToHousehold,
  writeRecipePref,
} from '@/lib/db/repositories/recipe-repo';
import { applyRecipePrefPatch, countRecipesByIngredient } from '@/lib/domain/prefs';
import { normalizeCanonicalName } from '@/lib/domain/recipe-text';
import {
  INGREDIENT_NAME_MAX,
  type IngredientPref,
  type IngredientPrefEntry,
  type IngredientPrefsView,
  type RecipePref,
  type SetIngredientPrefResult,
  type UpdateRecipePrefRequest,
} from '@/lib/domain/types';

/** Conteggio delle ricette non bloccate per nome canonico, per l'household. */
async function loadCounts(householdId: string): Promise<Map<string, number>> {
  return countRecipesByIngredient(await listRecipes({ household_id: householdId }));
}

/** Aggiorna le preferenze di una ricetta dell'household; null se la ricetta non è sua. */
export async function updateRecipePref(
  recipeId: string,
  patch: UpdateRecipePrefRequest,
  householdId?: string
): Promise<RecipePref | null> {
  const household = await loadHousehold(householdId);
  return db.transaction(async (tx) => {
    if (!(await recipeBelongsToHousehold(tx, recipeId, household.id))) return null;
    const current = await lockRecipePref(tx, recipeId);
    const next = applyRecipePrefPatch(current, patch);
    return writeRecipePref(tx, recipeId, next);
  });
}

/** Giudizi sugli ingredienti con l'impatto, in due liste alfabetiche. */
export async function listIngredientPrefs(householdId?: string): Promise<IngredientPrefsView> {
  const household = await loadHousehold(householdId);
  const rows = await listIngredientPrefRows(db, household.id);
  const counts = await loadCounts(household.id);

  const entries: IngredientPrefEntry[] = rows.map((row) => ({
    canonical_name: row.canonical_name,
    pref: row.pref,
    recipes_count: counts.get(row.canonical_name) ?? 0,
  }));
  const byName = (a: IngredientPrefEntry, b: IngredientPrefEntry) =>
    a.canonical_name.localeCompare(b.canonical_name, 'it');

  return {
    likes: entries.filter((e) => e.pref === 'like').sort(byName),
    dislikes: entries.filter((e) => e.pref === 'dislike').sort(byName),
  };
}

/** Imposta (like/dislike) o rimuove (null) il giudizio su un ingrediente. */
export async function setIngredientPref(
  canonicalName: string,
  pref: IngredientPref | null,
  householdId?: string
): Promise<SetIngredientPrefResult> {
  const name = normalizeCanonicalName(canonicalName);
  if (name.length === 0 || name.length > INGREDIENT_NAME_MAX) {
    throw new RangeError('canonical_name non valido');
  }

  const household = await loadHousehold(householdId);
  if (pref === null) {
    await deleteIngredientPref(db, household.id, name);
  } else {
    await upsertIngredientPref(db, household.id, name, pref);
  }

  const counts = await loadCounts(household.id);
  return { canonical_name: name, pref, recipes_count: counts.get(name) ?? 0 };
}
