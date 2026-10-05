import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../index';
import { ingredient_prefs } from '../schema';
import { IngredientPrefSchema, type IngredientPref } from '@/lib/domain/types';

export interface IngredientPrefRow {
  canonical_name: string;
  pref: IngredientPref;
  created_at: Date;
}

/** Giudizi dell'household, in ordine crescente di canonical_name. */
export async function listIngredientPrefRows(
  executor: DbExecutor,
  householdId: string
): Promise<IngredientPrefRow[]> {
  const rows = await executor
    .select({
      canonical_name: ingredient_prefs.canonical_name,
      pref: ingredient_prefs.pref,
      created_at: ingredient_prefs.created_at,
    })
    .from(ingredient_prefs)
    .where(eq(ingredient_prefs.household_id, householdId))
    .orderBy(asc(ingredient_prefs.canonical_name));

  return rows.map((row) => ({ ...row, pref: IngredientPrefSchema.parse(row.pref) }));
}

/** Inserisce o sovrascrive il giudizio. `canonicalName` deve essere già normalizzato. */
export async function upsertIngredientPref(
  executor: DbExecutor,
  householdId: string,
  canonicalName: string,
  pref: IngredientPref
): Promise<void> {
  await executor
    .insert(ingredient_prefs)
    .values({ household_id: householdId, canonical_name: canonicalName, pref })
    .onConflictDoUpdate({
      target: [ingredient_prefs.household_id, ingredient_prefs.canonical_name],
      set: { pref },
    });
}

/** Rimuove il giudizio; false se non c'era. */
export async function deleteIngredientPref(
  executor: DbExecutor,
  householdId: string,
  canonicalName: string
): Promise<boolean> {
  const deleted = await executor
    .delete(ingredient_prefs)
    .where(
      and(
        eq(ingredient_prefs.household_id, householdId),
        eq(ingredient_prefs.canonical_name, canonicalName)
      )
    )
    .returning({ canonical_name: ingredient_prefs.canonical_name });

  return deleted.length > 0;
}
