// Solo lato server. Punto di lettura condiviso delle preferenze ingredienti
// (importabile sia da `lib/plans` sia da `lib/recipes`).

import { db, type DbExecutor } from '@/lib/db';
import { listIngredientPrefRows } from '@/lib/db/repositories/ingredient-pref-repo';
import {
  toIngredientPreferenceSets,
  type IngredientPreferenceSets,
} from '@/lib/domain/planner';

/**
 * Preferenze ingredienti (likes/dislikes normalizzati) dell'household, lette da `ingredient_prefs`.
 */
export async function loadIngredientPreferences(
  householdId: string,
  executor: DbExecutor = db
): Promise<IngredientPreferenceSets> {
  const rows = await listIngredientPrefRows(executor, householdId);
  return toIngredientPreferenceSets(
    rows.filter((row) => row.pref === 'like').map((row) => row.canonical_name),
    rows.filter((row) => row.pref === 'dislike').map((row) => row.canonical_name)
  );
}
