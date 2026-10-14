// Solo lato server: importa il DB e il modulo recipes. I componenti client usano client.ts, format.ts ed errors.ts.

import { db, type DbExecutor } from '@/lib/db';
import { getHouseholdById, loadHousehold } from '@/lib/db/repositories/household-repo';
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
  markShoppingListStale,
  setSlotLocked,
  touchPlanGeneratedAt,
  updateSlotRecipe,
  updateSlotsServings,
  type PlanSlotRecord,
  type PlanWithSlots,
} from '@/lib/db/repositories/plan-repo';
import { listRecipesWith, type RecipeWithDetails } from '@/lib/db/repositories/recipe-repo';
import { compareLibraryCards, toLibraryCard } from '@/lib/domain/library';
import { isPlanClosed } from '@/lib/domain/plan-status';
import { APP_TIME_ZONE, PLANNER_CONFIG, type PlannerConfig } from '@/lib/domain/planner-config';
import {
  computeGenerationCount,
  exclusionReason,
  manualChoiceExclusionReason,
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
  type PlanMutationResult,
  type PlanResult,
  type PlanScreenView,
  type PlanStatus,
  type PlanView,
  type PlanWeek,
  type PlanWeekView,
  type SlotCandidates,
  type SwapSlotRequest,
} from '@/lib/domain/types';
import { addDays, isoWeekday, listDays, mondayOf, resolveTargetWeek, todayInTimeZone } from '@/lib/domain/week';
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

export { isPlanClosed };

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

  // Sorgente di "Ripeti questa settimana" (weekend: obiettivo = settimana successiva).
  let currentPlanId: string | null = null;
  if (currentWeekStart !== target.week_start && !targetBlocksRepeat) {
    const currentPlan =
      shownWeekStart === currentWeekStart
        ? shownPlan
        : await findPlanByWeek(db, household.id, currentWeekStart);
    if (currentPlan && currentPlan.slots.some((slot) => slot.recipe_id !== null)) {
      currentPlanId = currentPlan.id;
    }
  }

  return {
    today,
    current_week_start: currentWeekStart,
    target,
    view,
    prev_week_start: prev,
    next_week_start: next,
    target_plan_status: targetPlan?.status ?? null,
    current_plan_id: currentPlanId,
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

/** Household e preferenze riletti con `executor`: dentro il lock vedono le impostazioni salvate nel frattempo. */
async function loadConstraints(
  householdId: string,
  executor: DbExecutor
): Promise<{ household: Household; prefs: IngredientPreferenceSets }> {
  const household = await getHouseholdById(householdId, executor);
  if (!household) throw new Error(`Household ${householdId} non trovato`);
  return { household, prefs: await loadIngredientPreferences(householdId, executor) };
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
 * 2. Dentro la transazione, dopo il lock: si rileggono piano, libreria e impostazioni
 *    (salvate magari durante la generazione) e si rifà la selezione sullo stato riletto,
 *    poi si scrive. Se resta uno slot vuoto, rollback.
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

    // `generated_at` (now() della transazione) coprirà solo le impostazioni lette qui.
    const constraints = await loadConstraints(household.id, tx);
    const finalCtx: PlanContext = { ...ctx, ...constraints };
    const persons = constraints.household.persons;

    const finalSelection = computeSelection(
      finalCtx,
      current,
      await loadLibrary(tx),
      build.preassigned
    );
    if (hasGap(finalSelection)) throw llmError ?? new PlanError('insufficient_recipes');

    let planId: string;
    if (current === null) {
      planId = (await insertPlan(tx, household.id, target.week_start)).id;
      // Solo le settimane concluse: nel weekend il piano in corso resta consultabile e modificabile.
      await archivePlansBefore(tx, household.id, ctx.currentWeekStart);
    } else {
      planId = current.id;
      await touchPlanGeneratedAt(tx, current.id);
      // Le liste sono legate al piano (`/lista?piano=`): anche quella di una bozza va rifatta.
      await markShoppingListStale(tx, current.id);
      const keptIds = new Set(finalSelection.kept.map((slot) => slot.id));
      await deleteSlots(
        tx,
        current.slots.filter((slot) => !keptIds.has(slot.id)).map((slot) => slot.id)
      );
      await updateSlotsServings(
        tx,
        finalSelection.kept.filter((slot) => slot.day >= target.first_day).map((slot) => slot.id),
        persons
      );
    }

    await insertSlots(
      tx,
      planId,
      finalSelection.fills.map(({ slot, recipeId }) => ({
        day: slot.day,
        meal: slot.meal,
        recipe_id: recipeId,
        servings: persons,
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

// ============================================================================
// Swap di uno slot
// ============================================================================

/**
 * Slot sostituibile del piano, oppure l'errore di dominio corrispondente. I giorni passati
 * sono immutabili come nella rigenerazione (bloccarli resta consentito).
 */
function findSwappableSlot(plan: PlanWithSlots, slotId: string, today: string): PlanSlotRecord {
  const slot = plan.slots.find((candidate) => candidate.id === slotId);
  if (!slot) throw new PlanError('slot_not_found');
  if (slot.locked) throw new PlanError('slot_locked');
  if (slot.day < today) throw new PlanError('slot_past');
  return slot;
}

/**
 * Sostituisce la ricetta di uno slot senza riproporre ricette del piano o già scartate.
 * L'LLM interviene (fuori da transazioni) solo se la libreria non offre alternative; la
 * scelta definitiva si rifà dentro il lock sullo stato riletto, così due swap concorrenti
 * non assegnano la stessa ricetta a due slot.
 */
export async function swapSlot(
  planId: string,
  slotId: string,
  request: SwapSlotRequest,
  options: PlanServiceOptions = {}
): Promise<PlanMutationResult> {
  const household = await loadHousehold(options.householdId);
  const { now, today, currentWeekStart } = resolveClock(options);
  const rng = options.rng ?? createRng(randomSeed());
  const config = options.config ?? PLANNER_CONFIG;
  const generate = options.generate ?? ((input) => generateAndStoreRecipes(input));

  /** Ricetta scelta per lo slot dato piano, libreria e impostazioni letti nello stesso istante. */
  const pickRecipe = (
    plan: PlanWithSlots,
    slot: PlanSlotRecord,
    library: readonly RecipeWithDetails[],
    { household, prefs }: Awaited<ReturnType<typeof loadConstraints>>
  ): string | null => {
    const exclude = new Set<string>(request.exclude_recipe_ids);
    for (const planSlot of plan.slots) {
      if (planSlot.recipe_id !== null) exclude.add(planSlot.recipe_id);
    }
    const { assignments } = selectRecipes({
      slots: [{ key: slot.id, day: slot.day, meal: slot.meal }],
      candidates: library,
      household,
      ingredientPrefs: prefs,
      excludeRecipeIds: exclude,
      now,
      rng,
      config,
    });
    return assignments[0]?.recipeId ?? null;
  };
  const loadLibrary = (executor: DbExecutor) =>
    listRecipesWith(executor, { household_id: household.id });

  // Fase 1 (fuori dalla transazione): decide solo se generare.
  const plan = await loadOpenOwnedPlan(db, planId, household, currentWeekStart);
  const slot = findSwappableSlot(plan, slotId, today);

  let rounds = 0;
  let created = 0;
  let llmError: LlmError | null = null;

  const initialConstraints = await loadConstraints(household.id, db);
  if (pickRecipe(plan, slot, await loadLibrary(db), initialConstraints) === null) {
    if (config.maxGenerationRoundsSwap > 0) {
      rounds = 1;
      try {
        const result = await generate({
          householdId: household.id,
          count: config.generationMin,
          mealType: slot.meal,
        });
        created = result.created.length;
      } catch (err) {
        if (!isLlmError(err)) throw err;
        llmError = err;
      }
    }
    // Uscita rapida: niente da scrivere se non c'è alternativa nemmeno dopo la generazione.
    const refreshed = await loadOpenOwnedPlan(db, planId, household, currentWeekStart);
    const refreshedSlot = findSwappableSlot(refreshed, slotId, today);
    const constraints = await loadConstraints(household.id, db);
    if (pickRecipe(refreshed, refreshedSlot, await loadLibrary(db), constraints) === null) {
      throw llmError ?? new PlanError('no_alternatives');
    }
  }

  // Fase 2 (sotto lock): rilegge tutto (impostazioni comprese), rifà la scelta e scrive.
  const { updated, freshHousehold } = await db.transaction(async (tx) => {
    await acquirePlanLock(tx, household.id);
    const current = await loadOpenOwnedPlan(tx, planId, household, currentWeekStart);
    const currentSlot = findSwappableSlot(current, slotId, today);

    const constraints = await loadConstraints(household.id, tx);
    const recipeId = pickRecipe(current, currentSlot, await loadLibrary(tx), constraints);
    if (recipeId === null) throw llmError ?? new PlanError('no_alternatives');

    await updateSlotRecipe(tx, slotId, recipeId);
    if (current.status === 'active') {
      await incrementRecipeUsage(tx, [{ recipeId, day: currentSlot.day }]);
    }
    await markShoppingListStale(tx, planId);

    const fresh = await getPlanById(tx, planId);
    if (!fresh) throw new PlanError('plan_not_found');
    return { updated: fresh, freshHousehold: constraints.household };
  });

  return {
    plan: toPlanView(updated, freshHousehold),
    generation: { rounds, created, failed: llmError !== null },
  };
}

// ============================================================================
// Scelta a mano di una ricetta
// ============================================================================

/**
 * Ricette della libreria che si possono mettere a mano nello slot: non bloccate, del tipo
 * di pasto dello slot, che rispettano diete ed elettrodomestici. Gli ingredienti «non mi
 * piace» non le escludono. Manca quella già nello slot; l'ordine è quello della Libreria.
 */
export async function listSlotCandidates(
  planId: string,
  slotId: string,
  options: PlanServiceOptions = {}
): Promise<SlotCandidates> {
  const household = await loadHousehold(options.householdId);
  const { today, currentWeekStart } = resolveClock(options);

  const plan = await loadOpenOwnedPlan(db, planId, household, currentWeekStart);
  const slot = findSwappableSlot(plan, slotId, today);

  const library = await listRecipesWith(db, { household_id: household.id });
  const recipes = library
    .filter(
      (recipe) =>
        recipe.id !== slot.recipe_id &&
        manualChoiceExclusionReason(recipe, slot.meal, household) === null
    )
    .map(toLibraryCard)
    .sort(compareLibraryCards);

  const inPlan = new Set<string>();
  for (const other of plan.slots) {
    if (other.id !== slot.id && other.recipe_id !== null) inPlan.add(other.recipe_id);
  }
  return { recipes, in_plan_recipe_ids: [...inPlan] };
}

/**
 * Mette nello slot la ricetta scelta dall'utente. Stessi effetti di uno swap (uso della
 * ricetta se il piano è confermato, lista della spesa da aggiornare), ma nessun sorteggio
 * e nessuna chiamata LLM. Tutto si rilegge sotto il lock dei piani dell'household.
 */
export async function assignSlotRecipe(
  planId: string,
  slotId: string,
  recipeId: string,
  options: PlanServiceOptions = {}
): Promise<PlanResult> {
  const household = await loadHousehold(options.householdId);
  const { today, currentWeekStart } = resolveClock(options);

  const { updated, freshHousehold } = await db.transaction(async (tx) => {
    await acquirePlanLock(tx, household.id);
    const plan = await loadOpenOwnedPlan(tx, planId, household, currentWeekStart);
    const slot = findSwappableSlot(plan, slotId, today);

    const current = await getHouseholdById(household.id, tx);
    if (!current) throw new Error(`Household ${household.id} non trovato`);

    const library = await listRecipesWith(tx, { household_id: household.id });
    const recipe = library.find((candidate) => candidate.id === recipeId);
    if (!recipe) throw new PlanError('recipe_not_found');
    if (manualChoiceExclusionReason(recipe, slot.meal, current) !== null) {
      throw new PlanError('recipe_not_eligible');
    }

    // Richiesta ripetuta: la ricetta è già quella dello slot, niente da scrivere.
    if (slot.recipe_id === recipeId) return { updated: plan, freshHousehold: current };

    await updateSlotRecipe(tx, slotId, recipeId);
    if (plan.status === 'active') {
      await incrementRecipeUsage(tx, [{ recipeId, day: slot.day }]);
    }
    await markShoppingListStale(tx, planId);

    const fresh = await getPlanById(tx, planId);
    if (!fresh) throw new PlanError('plan_not_found');
    return { updated: fresh, freshHousehold: current };
  });

  return { plan: toPlanView(updated, freshHousehold) };
}

// ============================================================================
// Ripeti un piano sulla settimana da pianificare
// ============================================================================

/**
 * Copia un piano (anche di una settimana conclusa) sulla settimana obiettivo: per ogni
 * pasto la ricetta dello stesso giorno della settimana, se ancora ammessa. Il resto lo
 * riempie il planner; l'LLM interviene solo se resta uno slot vuoto.
 */
export async function repeatPlan(
  sourcePlanId: string,
  options: PlanServiceOptions = {}
): Promise<GeneratePlanResult> {
  const ctx = await resolvePlanContext(options);

  const source = await getPlanById(db, sourcePlanId);
  if (!source || source.household_id !== ctx.household.id) throw new PlanError('plan_not_found');
  if (source.week_start === ctx.target.week_start) throw new PlanError('repeat_same_week');

  const preassigned = new Map<string, string>();
  for (const slot of source.slots) {
    if (slot.recipe_id === null) continue;
    const day = addDays(ctx.target.week_start, isoWeekday(slot.day) - 1);
    preassigned.set(slotKey(day, slot.meal), slot.recipe_id);
  }

  const generation = await buildTargetPlan(ctx, {
    preassigned,
    generation: 'unfilledOnly',
    maxRounds: ctx.config.maxGenerationRoundsSwap,
  });
  const screen = await getPlanScreen({ ...options, week: ctx.target.week_start });
  return { screen, generation };
}
