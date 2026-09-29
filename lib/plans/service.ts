// Solo lato server: importa il DB e il modulo recipes. I componenti client usano client.ts, format.ts ed errors.ts.

import { db, type DbExecutor } from '@/lib/db';
import { loadHousehold } from '@/lib/db/repositories/household-repo';
import {
  acquirePlanLock,
  activateDraftPlan,
  archivePlansBefore,
  deleteSlots,
  findPlanByWeek,
  getPlanById,
  incrementRecipeUsage,
  insertPlan,
  insertSlots,
  listPlanWeeks,
  setSlotLocked,
  touchPlanGeneratedAt,
  updateSlotsServings,
  type PlanSlotRecord,
  type PlanWithSlots,
} from '@/lib/db/repositories/plan-repo';
import { listRecipesWith, type RecipeWithDetails } from '@/lib/db/repositories/recipe-repo';
import { APP_TIME_ZONE, PLANNER_CONFIG, type PlannerConfig } from '@/lib/domain/planner-config';
import {
  computeGenerationCount,
  exclusionReason,
  selectRecipes,
  splitGenerationBatches,
  type IngredientPreferenceSets,
  type MealTypeShortage,
  type PlannerResult,
  type PlannerSlot,
} from '@/lib/domain/planner';
import { createRng, randomSeed, type Rng } from '@/lib/domain/rng';
import {
  IsoDateSchema,
  MEAL_TYPE_VALUES,
  type GeneratePlanResult,
  type Household,
  type MealType,
  type PlanAction,
  type PlanResult,
  type PlanScreenView,
  type PlanStatus,
  type PlanView,
  type PlanWeek,
  type PlanWeekView,
} from '@/lib/domain/types';
import { addDays, listDays, mondayOf, resolveTargetWeek, todayInTimeZone } from '@/lib/domain/week';
import { isLlmError, type LlmError } from '@/lib/llm/errors';
import { loadIngredientPreferences } from '@/lib/prefs/ingredient-prefs';
import {
  generateAndStoreRecipes,
  type GenerateAndStoreInput,
  type GenerateAndStoreResult,
} from '@/lib/recipes';
import { PlanError } from './errors';

const DAYS_PER_WEEK = 7;

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

const slotKey = (day: string, meal: MealType): string => `${day}|${meal}`;

/**
 * Un piano è "chiuso" (solo consultazione) se archiviato o se la sua settimana è
 * già conclusa. Calcolato, non letto dallo stato: `archivePlansBefore` scatta solo
 * alla creazione di un piano nuovo.
 */
export function isPlanClosed(
  plan: { status: PlanStatus; week_start: string },
  currentWeekStart: string
): boolean {
  return plan.status === 'archived' || plan.week_start < currentWeekStart;
}

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

function resolveClock(options: PlanServiceOptions): Clock {
  const now = (options.now ?? (() => new Date()))();
  const today = todayInTimeZone(now, APP_TIME_ZONE);
  return {
    now,
    today,
    currentWeekStart: mondayOf(today),
    target: resolveTargetWeek(today),
  };
}

/** Data `YYYY-MM-DD` reale (rifiuta 2026-02-31). */
function isValidIsoDate(value: string): boolean {
  return IsoDateSchema.safeParse(value).success && addDays(value, 0) === value;
}

/** Settimana richiesta -> lunedì, oppure `undefined` se non valida o oltre la settimana obiettivo. */
function normalizeRequestedWeek(week: string | undefined, targetWeekStart: string): string | undefined {
  if (week === undefined || !isValidIsoDate(week)) return undefined;
  const monday = mondayOf(week);
  return monday > targetWeekStart ? undefined : monday;
}

function assertTargetPlanWritable(plan: { status: PlanStatus } | null): void {
  if (plan?.status === 'active') throw new PlanError('plan_confirmed');
  if (plan?.status === 'archived') throw new PlanError('plan_archived');
}

// ============================================================================
// Schermata
// ============================================================================

export async function getPlanScreen(
  options: PlanServiceOptions & { week?: string } = {}
): Promise<PlanScreenView> {
  const household = await loadHousehold(options.householdId);
  const { today, currentWeekStart, target } = resolveClock(options);

  const planWeeks = await listPlanWeeks(db, household.id);
  const requested = normalizeRequestedWeek(options.week, target.week_start);
  const shownWeekStart =
    requested ?? (planWeeks.includes(currentWeekStart) ? currentWeekStart : target.week_start);
  const isTargetShown = shownWeekStart === target.week_start;

  const shownPlan = await findPlanByWeek(db, household.id, shownWeekStart);
  const targetPlan = isTargetShown
    ? shownPlan
    : await findPlanByWeek(db, household.id, target.week_start);

  const week: PlanWeek = isTargetShown
    ? target
    : {
        week_start: shownWeekStart,
        first_day: shownWeekStart,
        last_day: addDays(shownWeekStart, DAYS_PER_WEEK - 1),
      };

  let action: PlanAction = 'none';
  if (isTargetShown) {
    action = !shownPlan ? 'generate' : shownPlan.status === 'draft' ? 'regenerate' : 'none';
  }

  const targetBlocksRepeat =
    targetPlan !== null &&
    (targetPlan.status === 'active' || isPlanClosed(targetPlan, currentWeekStart));
  const canRepeat =
    shownPlan !== null &&
    shownPlan.slots.some((slot) => slot.recipe_id !== null) &&
    !isTargetShown &&
    !targetBlocksRepeat;

  const view: PlanWeekView = {
    week,
    plan: shownPlan ? toPlanView(shownPlan, household) : null,
    action,
    editable: shownPlan !== null && !isPlanClosed(shownPlan, currentWeekStart),
    can_repeat: canRepeat,
  };

  // Settimane raggiungibili: con un piano, corrente, obiettivo; mai oltre l'obiettivo.
  const reachable = [...new Set([...planWeeks, currentWeekStart, target.week_start])]
    .filter((weekStart) => weekStart <= target.week_start)
    .sort();
  const prev = reachable.filter((weekStart) => weekStart < shownWeekStart).at(-1) ?? null;
  const next = reachable.find((weekStart) => weekStart > shownWeekStart) ?? null;

  return {
    today,
    current_week_start: currentWeekStart,
    target,
    view,
    prev_week_start: prev,
    next_week_start: next,
  };
}

// ============================================================================
// Costruzione del piano della settimana obiettivo (generatePlan, repeatPlan)
// ============================================================================

interface PlanContext {
  household: Household;
  today: string;
  currentWeekStart: string;
  target: PlanWeek;
  now: Date;
  rng: Rng;
  config: PlannerConfig;
  generate: GenerateRecipesFn;
  prefs: IngredientPreferenceSets;
}

async function resolvePlanContext(options: PlanServiceOptions): Promise<PlanContext> {
  const household = await loadHousehold(options.householdId);
  const clock = resolveClock(options);
  return {
    household,
    today: clock.today,
    currentWeekStart: clock.currentWeekStart,
    target: clock.target,
    now: clock.now,
    rng: options.rng ?? createRng(randomSeed()),
    config: options.config ?? PLANNER_CONFIG,
    generate: options.generate ?? ((input) => generateAndStoreRecipes(input)),
    prefs: await loadIngredientPreferences(household.id),
  };
}

interface BuildTargetPlanOptions {
  /** Chiave slot `${day}|${meal}` -> id ricetta da assegnare in anticipo (validata qui). */
  preassigned?: ReadonlyMap<string, string>;
  /**
   * `needMore`: genera finché il planner segnala carenza (generatePlan).
   * `unfilledOnly`: genera solo finché resta uno slot senza ricetta (repeatPlan).
   */
  generation: 'needMore' | 'unfilledOnly';
  /** Tetto ai giri di generazione. */
  maxRounds: number;
}

/** Esito di una selezione sullo stato (piano corrente + libreria) letto in un dato istante. */
interface Selection {
  /** Slot mantenuti: giorni passati e bloccati. */
  kept: PlanSlotRecord[];
  /** Slot da riempire, con la ricetta scelta (pre-assegnata o dal planner), `null` se manca. */
  fills: { slot: PlannerSlot; recipeId: string | null }[];
  /** Risultato del planner sugli slot non pre-assegnati. */
  planner: PlannerResult;
}

function desiredSlots(ctx: PlanContext): PlannerSlot[] {
  const meals = MEAL_TYPE_VALUES.filter((meal) => ctx.household.meals.includes(meal));
  return listDays(ctx.target.first_day, ctx.target.last_day).flatMap((day) =>
    meals.map((meal) => ({ key: slotKey(day, meal), day, meal }))
  );
}

/**
 * Calcola kept/toFill/exclude dal piano `existing`, valida le pre-assegnazioni sulla
 * `library` e riempie il resto con il planner. Pura rispetto al DB: la chiamano sia la
 * fase che decide se generare sia la transazione che scrive.
 */
function computeSelection(
  ctx: PlanContext,
  existing: PlanWithSlots | null,
  library: readonly RecipeWithDetails[],
  preassigned: ReadonlyMap<string, string> | undefined
): Selection {
  const kept = (existing?.slots ?? []).filter(
    (slot) => slot.day < ctx.target.first_day || slot.locked
  );
  const keptKeys = new Set(kept.map((slot) => slotKey(slot.day, slot.meal)));
  const toFill = desiredSlots(ctx).filter((slot) => !keptKeys.has(slot.key));

  const usedRecipeIds = new Set(
    kept.map((slot) => slot.recipe_id).filter((id): id is string => id !== null)
  );
  const libraryById = new Map(library.map((recipe) => [recipe.id, recipe]));

  const fixed = new Map<string, string>();
  for (const slot of toFill) {
    const recipeId = preassigned?.get(slot.key);
    const recipe = recipeId === undefined ? undefined : libraryById.get(recipeId);
    if (recipeId === undefined || recipe === undefined) continue;
    const reason = exclusionReason(recipe, slot.meal, {
      household: ctx.household,
      ingredientPrefs: ctx.prefs,
      excludeRecipeIds: usedRecipeIds,
    });
    if (reason !== null) continue;
    fixed.set(slot.key, recipeId);
    usedRecipeIds.add(recipeId);
  }

  const planner = selectRecipes({
    slots: toFill.filter((slot) => !fixed.has(slot.key)),
    candidates: library,
    household: ctx.household,
    ingredientPrefs: ctx.prefs,
    excludeRecipeIds: usedRecipeIds,
    now: ctx.now,
    rng: ctx.rng,
    config: ctx.config,
  });
  const selected = new Map(planner.assignments.map((a) => [a.key, a.recipeId]));

  return {
    kept,
    fills: toFill.map((slot) => ({
      slot,
      recipeId: fixed.get(slot.key) ?? selected.get(slot.key) ?? null,
    })),
    planner,
  };
}

const hasGap = (selection: Selection): boolean =>
  selection.fills.some((fill) => fill.recipeId === null);

function shortagesToGenerate(
  selection: Selection,
  mode: BuildTargetPlanOptions['generation']
): MealTypeShortage[] {
  if (mode === 'needMore') return selection.planner.needMore;
  return selection.planner.needMore.filter((shortage) => shortage.unfilled > 0);
}

function needsGeneration(selection: Selection, mode: BuildTargetPlanOptions['generation']): boolean {
  return shortagesToGenerate(selection, mode).length > 0;
}

/**
 * Costruisce e scrive il piano della settimana obiettivo.
 *
 * 1. Fuori dalla transazione: selezione e generazione LLM (a lotti, in parallelo) servono
 *    solo a decidere se e quanto generare.
 * 2. Dentro la transazione, dopo il lock: si rilegge piano e libreria e si rifà la
 *    selezione sullo stato riletto, poi si scrive. Se resta uno slot vuoto, rollback.
 */
async function buildTargetPlan(
  ctx: PlanContext,
  build: BuildTargetPlanOptions
): Promise<GeneratePlanResult['generation']> {
  const { household, target, config } = ctx;

  assertTargetPlanWritable(await findPlanByWeek(db, household.id, target.week_start));

  const loadLibrary = (executor: DbExecutor) =>
    listRecipesWith(executor, { household_id: household.id });
  const select = async (): Promise<Selection> =>
    computeSelection(
      ctx,
      await findPlanByWeek(db, household.id, target.week_start),
      await loadLibrary(db),
      build.preassigned
    );

  let selection = await select();
  let rounds = 0;
  let created = 0;
  let llmError: LlmError | null = null;
  let stop = false;

  while (needsGeneration(selection, build.generation) && rounds < build.maxRounds && !stop) {
    rounds++;
    // Tutti i lotti (<= generationBatchSize ricette) di tutti i tipi di pasto in parallelo.
    const batches = shortagesToGenerate(selection, build.generation).flatMap((shortage) =>
      splitGenerationBatches(computeGenerationCount(shortage, config), config).map((count) => ({
        mealType: shortage.meal_type,
        count,
      }))
    );
    const outcomes = await Promise.allSettled(
      batches.map((batch) =>
        ctx.generate({ householdId: household.id, count: batch.count, mealType: batch.mealType })
      )
    );

    let createdThisRound = 0;
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') {
        createdThisRound += outcome.value.created.length;
      } else if (!isLlmError(outcome.reason)) {
        throw outcome.reason;
      } else {
        llmError ??= outcome.reason;
        stop = true;
      }
    }
    created += createdThisRound;
    if (createdThisRound === 0) stop = true;

    selection = await select();
  }

  // Uscita rapida: niente da scrivere se la libreria non basta.
  if (hasGap(selection)) throw llmError ?? new PlanError('insufficient_recipes');

  await db.transaction(async (tx) => {
    await acquirePlanLock(tx, household.id);
    const current = await findPlanByWeek(tx, household.id, target.week_start);
    assertTargetPlanWritable(current);

    const finalSelection = computeSelection(ctx, current, await loadLibrary(tx), build.preassigned);
    if (hasGap(finalSelection)) throw llmError ?? new PlanError('insufficient_recipes');

    let planId: string;
    if (current === null) {
      planId = (await insertPlan(tx, household.id, target.week_start)).id;
      // Solo le settimane concluse: nel weekend il piano in corso resta consultabile e modificabile.
      await archivePlansBefore(tx, household.id, ctx.currentWeekStart);
    } else {
      planId = current.id;
      await touchPlanGeneratedAt(tx, current.id);
      const keptIds = new Set(finalSelection.kept.map((slot) => slot.id));
      await deleteSlots(
        tx,
        current.slots.filter((slot) => !keptIds.has(slot.id)).map((slot) => slot.id)
      );
      await updateSlotsServings(
        tx,
        finalSelection.kept.filter((slot) => slot.day >= target.first_day).map((slot) => slot.id),
        household.persons
      );
    }

    await insertSlots(
      tx,
      planId,
      finalSelection.fills.map(({ slot, recipeId }) => ({
        day: slot.day,
        meal: slot.meal,
        recipe_id: recipeId,
        servings: household.persons,
        locked: false,
      }))
    );
  });

  return { rounds, created, failed: llmError !== null };
}

/**
 * Genera (o rigenera) il piano della settimana obiettivo. Gli slot dei giorni passati e
 * quelli bloccati restano; la libreria è la fonte, l'LLM interviene solo se non basta.
 */
export async function generatePlan(options: PlanServiceOptions = {}): Promise<GeneratePlanResult> {
  const ctx = await resolvePlanContext(options);
  const generation = await buildTargetPlan(ctx, {
    generation: 'needMore',
    maxRounds: ctx.config.maxGenerationRoundsPlan,
  });
  const screen = await getPlanScreen({ ...options, week: ctx.target.week_start });
  return { screen, generation };
}

// ============================================================================
// Conferma e blocco
// ============================================================================

/** Legge un piano dell'household (404 se assente o di un altro household) e rifiuta i piani chiusi. */
async function loadOpenOwnedPlan(
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

/**
 * Conferma una bozza: `active` + uso delle ricette (`times_used`, `last_used_at` = giorno
 * del pasto). Idempotente anche con richieste sovrapposte: l'uso si conta una volta sola.
 */
export async function confirmPlan(
  planId: string,
  options: PlanServiceOptions = {}
): Promise<PlanResult> {
  const household = await loadHousehold(options.householdId);
  const { currentWeekStart } = resolveClock(options);

  const plan = await loadOpenOwnedPlan(db, planId, household, currentWeekStart);
  if (plan.status === 'active') return { plan: toPlanView(plan, household) };

  const confirmed = await db.transaction(async (tx) => {
    await acquirePlanLock(tx, household.id);
    const locked = await loadOpenOwnedPlan(tx, planId, household, currentWeekStart);
    if (locked.status === 'draft' && (await activateDraftPlan(tx, planId))) {
      await incrementRecipeUsage(
        tx,
        locked.slots.flatMap((slot) =>
          slot.recipe_id === null ? [] : [{ recipeId: slot.recipe_id, day: slot.day }]
        )
      );
    }
    const fresh = await getPlanById(tx, planId);
    if (!fresh) throw new PlanError('plan_not_found');
    return fresh;
  });
  return { plan: toPlanView(confirmed, household) };
}

/** Blocca/sblocca uno slot (piani `draft` e `active` non chiusi). */
export async function setSlotLock(
  planId: string,
  slotId: string,
  locked: boolean,
  options: PlanServiceOptions = {}
): Promise<PlanResult> {
  const household = await loadHousehold(options.householdId);
  const { currentWeekStart } = resolveClock(options);

  // Sotto lock: una rigenerazione concorrente non può cancellare lo slot a metà.
  const updated = await db.transaction(async (tx) => {
    await acquirePlanLock(tx, household.id);
    const plan = await loadOpenOwnedPlan(tx, planId, household, currentWeekStart);
    if (!plan.slots.some((slot) => slot.id === slotId)) throw new PlanError('slot_not_found');
    await setSlotLocked(tx, slotId, locked);
    const fresh = await getPlanById(tx, planId);
    if (!fresh) throw new PlanError('plan_not_found');
    return fresh;
  });
  return { plan: toPlanView(updated, household) };
}
