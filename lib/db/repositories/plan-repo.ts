import { and, asc, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import type { DbExecutor } from '../index';
import { meal_plans, plan_slots, recipe_prefs, shopping_lists } from '../schema';
import { type RecipeWithDetails, toRecipeWithDetails } from './recipe-repo';
import {
  MEAL_TYPE_VALUES,
  MealTypeSchema,
  PlanStatusSchema,
  type MealType,
  type PlanStatus,
} from '@/lib/domain/types';

export interface PlanRecord {
  id: string;
  household_id: string;
  week_start: string; // YYYY-MM-DD
  status: PlanStatus;
  created_at: Date;
  generated_at: Date;
}

export interface PlanSlotRecord {
  id: string;
  plan_id: string;
  day: string; // YYYY-MM-DD
  meal: MealType;
  recipe_id: string | null;
  servings: number;
  locked: boolean;
  recipe: RecipeWithDetails | null;
}

export interface PlanWithSlots extends PlanRecord {
  /** Ordinati per giorno, poi per indice del pasto in MEAL_TYPE_VALUES. */
  slots: PlanSlotRecord[];
  shopping_list: { exists: boolean; needs_regeneration: boolean };
}

export interface NewSlotInput {
  day: string;
  meal: MealType;
  recipe_id: string | null;
  servings: number;
  locked: boolean;
}

export interface RecipeUsageInput {
  recipeId: string;
  /** Giorno del pasto, YYYY-MM-DD. */
  day: string;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Mezzogiorno UTC: basta per contare i giorni, senza aritmetica di fuso nel DB. */
const USAGE_TIME_SUFFIX = 'T12:00:00Z';

const PLAN_WITH_SLOTS_QUERY = {
  slots: { with: { recipe: { with: { ingredients: true, prefs: true } } } },
  shopping_list: true,
} as const;

type PlanRow = typeof meal_plans.$inferSelect;

function toPlanRecord(row: PlanRow): PlanRecord {
  return {
    id: row.id,
    household_id: row.household_id,
    week_start: row.week_start,
    status: PlanStatusSchema.parse(row.status),
    created_at: row.created_at,
    generated_at: row.generated_at,
  };
}

function compareSlots(a: PlanSlotRecord, b: PlanSlotRecord): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  return MEAL_TYPE_VALUES.indexOf(a.meal) - MEAL_TYPE_VALUES.indexOf(b.meal);
}

function mapPlanWithSlots(
  row: PlanRow & {
    slots: (typeof plan_slots.$inferSelect & { recipe: Record<string, unknown> | null })[];
    shopping_list: typeof shopping_lists.$inferSelect | null;
  }
): PlanWithSlots {
  const slots: PlanSlotRecord[] = row.slots
    .map((slot) => ({
      id: slot.id,
      plan_id: slot.plan_id,
      day: slot.day,
      meal: MealTypeSchema.parse(slot.meal),
      recipe_id: slot.recipe_id,
      servings: slot.servings,
      locked: slot.locked,
      recipe: slot.recipe ? toRecipeWithDetails(slot.recipe) : null,
    }))
    .sort(compareSlots);

  return {
    ...toPlanRecord(row),
    slots,
    shopping_list: {
      exists: row.shopping_list != null,
      needs_regeneration: row.shopping_list?.needs_regeneration ?? false,
    },
  };
}

/**
 * Cerca il piano di una settimana (con slot, ricette complete e stato della lista).
 */
export async function findPlanByWeek(
  executor: DbExecutor,
  householdId: string,
  weekStart: string
): Promise<PlanWithSlots | null> {
  const row = await executor.query.meal_plans.findFirst({
    where: and(eq(meal_plans.household_id, householdId), eq(meal_plans.week_start, weekStart)),
    with: PLAN_WITH_SLOTS_QUERY,
  });
  return row ? mapPlanWithSlots(row) : null;
}

/**
 * Legge un piano per id (con slot, ricette complete e stato della lista).
 */
export async function getPlanById(
  executor: DbExecutor,
  planId: string
): Promise<PlanWithSlots | null> {
  const row = await executor.query.meal_plans.findFirst({
    where: eq(meal_plans.id, planId),
    with: PLAN_WITH_SLOTS_QUERY,
  });
  return row ? mapPlanWithSlots(row) : null;
}

/**
 * Elenca i `week_start` (YYYY-MM-DD) dei piani dell'household, in ordine crescente.
 */
export async function listPlanWeeks(executor: DbExecutor, householdId: string): Promise<string[]> {
  const rows = await executor
    .select({ week_start: meal_plans.week_start })
    .from(meal_plans)
    .where(eq(meal_plans.household_id, householdId))
    .orderBy(asc(meal_plans.week_start));
  return rows.map((r) => r.week_start);
}

/**
 * Acquisisce un advisory lock a livello di transazione per i piani dell'household.
 * Solo dentro una transazione: viene rilasciato a commit o rollback.
 */
export async function acquirePlanLock(executor: DbExecutor, householdId: string): Promise<void> {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtext(${'mealy:plans:' + householdId}))`
  );
}

/**
 * Inserisce un piano `draft`; `created_at` e `generated_at` vengono dai default del DB.
 */
export async function insertPlan(
  executor: DbExecutor,
  householdId: string,
  weekStart: string
): Promise<PlanRecord> {
  const [row] = await executor
    .insert(meal_plans)
    .values({ household_id: householdId, week_start: weekStart, status: 'draft' })
    .returning();
  return toPlanRecord(row);
}

/**
 * Imposta `generated_at` all'istante del DB (piano appena (ri)generato).
 */
export async function touchPlanGeneratedAt(executor: DbExecutor, planId: string): Promise<void> {
  await executor
    .update(meal_plans)
    .set({ generated_at: sql`now()` })
    .where(eq(meal_plans.id, planId));
}

/**
 * Transizione condizionata `draft` -> `active`. Restituisce `true` solo se questa
 * chiamata ha effettivamente attivato il piano (idempotente anche con richieste sovrapposte).
 */
export async function activateDraftPlan(executor: DbExecutor, planId: string): Promise<boolean> {
  const rows = await executor
    .update(meal_plans)
    .set({ status: 'active' })
    .where(and(eq(meal_plans.id, planId), eq(meal_plans.status, 'draft')))
    .returning({ id: meal_plans.id });
  return rows.length > 0;
}

/**
 * Archivia i piani dell'household con `week_start` precedente a quello indicato.
 * Restituisce il numero di piani aggiornati.
 */
export async function archivePlansBefore(
  executor: DbExecutor,
  householdId: string,
  weekStart: string
): Promise<number> {
  const rows = await executor
    .update(meal_plans)
    .set({ status: 'archived' })
    .where(
      and(
        eq(meal_plans.household_id, householdId),
        lt(meal_plans.week_start, weekStart),
        ne(meal_plans.status, 'archived')
      )
    )
    .returning({ id: meal_plans.id });
  return rows.length;
}

export async function insertSlots(
  executor: DbExecutor,
  planId: string,
  slots: NewSlotInput[]
): Promise<void> {
  if (slots.length === 0) return;
  await executor.insert(plan_slots).values(
    slots.map((slot) => ({
      plan_id: planId,
      day: slot.day,
      meal: slot.meal,
      recipe_id: slot.recipe_id,
      servings: slot.servings,
      locked: slot.locked,
    }))
  );
}

export async function deleteSlots(executor: DbExecutor, slotIds: string[]): Promise<void> {
  if (slotIds.length === 0) return;
  await executor.delete(plan_slots).where(inArray(plan_slots.id, slotIds));
}

export async function updateSlotsServings(
  executor: DbExecutor,
  slotIds: string[],
  servings: number
): Promise<void> {
  if (slotIds.length === 0) return;
  await executor.update(plan_slots).set({ servings }).where(inArray(plan_slots.id, slotIds));
}

export async function updateSlotRecipe(
  executor: DbExecutor,
  slotId: string,
  recipeId: string
): Promise<void> {
  await executor.update(plan_slots).set({ recipe_id: recipeId }).where(eq(plan_slots.id, slotId));
}

/**
 * Blocca/sblocca uno slot. Restituisce `true` se lo slot esiste ed e' stato aggiornato.
 */
export async function setSlotLocked(
  executor: DbExecutor,
  slotId: string,
  locked: boolean
): Promise<boolean> {
  const rows = await executor
    .update(plan_slots)
    .set({ locked })
    .where(eq(plan_slots.id, slotId))
    .returning({ id: plan_slots.id });
  return rows.length > 0;
}

/**
 * Registra l'uso delle ricette: per ogni ricetta `times_used + 1` (una volta per
 * chiamata, anche con piu' slot) e `last_used_at` = mezzogiorno UTC del giorno del
 * pasto piu' recente. `last_used_at` non torna mai indietro nel tempo.
 * Con array vuoto non esegue query.
 */
export async function incrementRecipeUsage(
  executor: DbExecutor,
  usages: RecipeUsageInput[]
): Promise<void> {
  if (usages.length === 0) return;

  const latestDayByRecipe = new Map<string, string>();
  for (const { recipeId, day } of usages) {
    if (!ISO_DATE_PATTERN.test(day)) {
      throw new Error(`Giorno non valido per l'uso della ricetta ${recipeId}: ${day}`);
    }
    const current = latestDayByRecipe.get(recipeId);
    if (current === undefined || day > current) latestDayByRecipe.set(recipeId, day);
  }

  await executor
    .insert(recipe_prefs)
    .values(
      [...latestDayByRecipe].map(([recipe_id, day]) => ({
        recipe_id,
        times_used: 1,
        last_used_at: sql`${day + USAGE_TIME_SUFFIX}::timestamptz`,
      }))
    )
    .onConflictDoUpdate({
      target: recipe_prefs.recipe_id,
      set: {
        times_used: sql`${recipe_prefs.times_used} + 1`,
        last_used_at: sql`greatest(coalesce(${recipe_prefs.last_used_at}, excluded.last_used_at), excluded.last_used_at)`,
      },
    });
}

/**
 * Segna la lista della spesa del piano come da rigenerare.
 * Restituisce `true` se il piano aveva una lista.
 */
export async function markShoppingListStale(
  executor: DbExecutor,
  planId: string
): Promise<boolean> {
  const rows = await executor
    .update(shopping_lists)
    .set({ needs_regeneration: true })
    .where(eq(shopping_lists.plan_id, planId))
    .returning({ id: shopping_lists.id });
  return rows.length > 0;
}
