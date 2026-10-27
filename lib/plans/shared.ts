// Solo lato server. Tipi e helper comuni a build.ts (costruzione del piano) e dishes.ts (operazioni sui piatti).

import { type DbExecutor } from '@/lib/db';
import { getHouseholdById } from '@/lib/db/repositories/household-repo';
import { getPlanById, type PlanSlotRecord, type PlanWithSlots } from '@/lib/db/repositories/plan-repo';
import { isPlanClosed } from '@/lib/domain/plan-status';
import { APP_TIME_ZONE, type PlannerConfig } from '@/lib/domain/planner-config';
import { type IngredientPreferenceSets } from '@/lib/domain/planner';
import { type Rng } from '@/lib/domain/rng';
import {
  type Course,
  type CourseFilter,
  type Household,
  type MealType,
  type PlanView,
  type PlanWeek,
} from '@/lib/domain/types';
import { mondayOf, resolveTargetWeek, todayInTimeZone } from '@/lib/domain/week';
import { loadIngredientPreferences } from '@/lib/prefs/ingredient-prefs';
import { type GenerateAndStoreInput, type GenerateAndStoreResult } from '@/lib/recipes';
import { PlanError } from './errors';

export type GenerateRecipesFn = (input: GenerateAndStoreInput) => Promise<GenerateAndStoreResult>;

export interface PlanServiceOptions {
  /** Default: singleton. */
  householdId?: string;
  /** Default: `() => new Date()`. */
  now?: () => Date;
  /** Default: `createRng(randomSeed())`. */
  rng?: Rng;
  /** Default: `generateAndStoreRecipes`. Mai chiamata dentro una transazione. */
  generate?: GenerateRecipesFn;
  /** Default: `PLANNER_CONFIG`. */
  config?: PlannerConfig;
}

// ============================================================================
// Helper puri
// ============================================================================

/** Chiave del pasto: `${day}|${meal}`. */
export const mealKey = (day: string, meal: MealType): string => `${day}|${meal}`;

/** Chiave dello slot (un piatto del pasto): `${day}|${meal}|${course}`. */
export const slotKey = (day: string, meal: MealType, course: Course): string =>
  `${day}|${meal}|${course}`;

export const sameMeal = (
  a: { day: string; meal: MealType },
  b: { day: string; meal: MealType }
): boolean => a.day === b.day && a.meal === b.meal;

/** Filtro di portata per la scelta a mano: un contorno per il contorno, una principale altrimenti. */
export const courseFilterOf = (slot: PlanSlotRecord): CourseFilter =>
  slot.course === 'contorno' ? 'contorno' : 'any-main';

/** Vista del piano per le API (date in ISO, `superseded` rispetto alle impostazioni). */
export function toPlanView(plan: PlanWithSlots, household: Household): PlanView {
  return {
    id: plan.id,
    week_start: plan.week_start,
    status: plan.status,
    created_at: plan.created_at.toISOString(),
    generated_at: plan.generated_at.toISOString(),
    superseded: household.updated_at.getTime() > plan.generated_at.getTime(),
    slots: plan.slots.map((slot) => ({
      id: slot.id,
      day: slot.day,
      meal: slot.meal,
      course: slot.course,
      servings: slot.servings,
      locked: slot.locked,
      recipe: slot.recipe,
    })),
    shopping_list: plan.shopping_list,
  };
}

interface Clock {
  now: Date;
  today: string;
  currentWeekStart: string;
  target: PlanWeek;
}

export function resolveClock(options: PlanServiceOptions): Clock {
  const now = (options.now ?? (() => new Date()))();
  const today = todayInTimeZone(now, APP_TIME_ZONE);
  return {
    now,
    today,
    currentWeekStart: mondayOf(today),
    target: resolveTargetWeek(today),
  };
}

// ============================================================================
// Letture comuni
// ============================================================================

/** Household e preferenze riletti con `executor`: dentro il lock vedono le impostazioni salvate nel frattempo. */
export async function loadConstraints(
  householdId: string,
  executor: DbExecutor
): Promise<{ household: Household; prefs: IngredientPreferenceSets }> {
  const household = await getHouseholdById(householdId, executor);
  if (!household) throw new Error(`Household ${householdId} non trovato`);
  return { household, prefs: await loadIngredientPreferences(householdId, executor) };
}

/** Legge un piano dell'household (404 se assente o di un altro household) e rifiuta i piani chiusi. */
export async function loadOpenOwnedPlan(
  executor: DbExecutor,
  planId: string,
  household: Household,
  currentWeekStart: string
): Promise<PlanWithSlots> {
  const plan = await getPlanById(executor, planId);
  if (!plan || plan.household_id !== household.id) throw new PlanError('plan_not_found');
  if (isPlanClosed(plan, currentWeekStart)) throw new PlanError('plan_archived');
  return plan;
}
