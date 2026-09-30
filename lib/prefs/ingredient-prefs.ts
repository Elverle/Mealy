// Solo lato server. Punto di lettura condiviso delle preferenze ingredienti
// (importabile sia da `lib/plans` sia da `lib/recipes`).

import { db, type DbExecutor } from '@/lib/db';
import {
  EMPTY_INGREDIENT_PREFERENCES,
  type IngredientPreferenceSets,
} from '@/lib/domain/planner';

/**
 * Preferenze ingredienti (likes/dislikes normalizzati) dell'household.
 * In F4 sono sempre vuote.
 */
export async function loadIngredientPreferences(
  householdId: string,
  executor: DbExecutor = db
): Promise<IngredientPreferenceSets> {
  void householdId;
  void executor;
  // F5 (S2.3): leggere ingredient_prefs e restituire toIngredientPreferenceSets(likes, dislikes); usarlo anche in buildConstraints (lib/recipes/constraints.ts)
  return EMPTY_INGREDIENT_PREFERENCES;
}
