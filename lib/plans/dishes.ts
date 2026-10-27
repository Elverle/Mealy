// Solo lato server. Operazioni sui piatti di un piano aperto: blocco del pasto, swap, contorni,
// scelta a mano e candidate. La costruzione del piano intero è in build.ts.

import { db, type DbExecutor } from '@/lib/db';
import { getHouseholdById, loadHousehold } from '@/lib/db/repositories/household-repo';
import {
  acquirePlanLock,
  deleteSlots,
  getPlanById,
  incrementRecipeUsage,
  insertSlots,
  markShoppingListStale,
  setMealLocked,
  updateSlotRecipe,
  type PlanSlotRecord,
  type PlanWithSlots,
} from '@/lib/db/repositories/plan-repo';
import { listRecipesWith, type RecipeWithDetails } from '@/lib/db/repositories/recipe-repo';
import { compareLibraryCards, toLibraryCard } from '@/lib/domain/library';
import { PLANNER_CONFIG } from '@/lib/domain/planner-config';
import { filterCourses, mainCourseForChoice } from '@/lib/domain/compositions';
import { manualChoiceExclusionReason, selectRecipes } from '@/lib/domain/planner';
import { createRng, randomSeed } from '@/lib/domain/rng';
import {
  type Course,
  type PlanMutationResult,
  type PlanResult,
  type SlotCandidates,
  type SwapSlotRequest,
} from '@/lib/domain/types';
import { isLlmError, type LlmError } from '@/lib/llm/errors';
import { generateAndStoreRecipes } from '@/lib/recipes';
import { PlanError } from './errors';
import {
  courseFilterOf,
  loadConstraints,
  loadOpenOwnedPlan,
  resolveClock,
  sameMeal,
  toPlanView,
  type PlanServiceOptions,
} from './shared';

// ============================================================================
// Blocco
// ============================================================================

/**
 * Blocca/sblocca il pasto dello slot indicato: tutti i suoi piatti (piani `draft` e `active`
 * non chiusi). Il blocco vale per il pasto intero, principale e contorno.
 */
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
    const slot = plan.slots.find((candidate) => candidate.id === slotId);
    if (!slot) throw new PlanError('slot_not_found');
    await setMealLocked(tx, planId, slot.day, slot.meal, locked);
    const fresh = await getPlanById(tx, planId);
    if (!fresh) throw new PlanError('plan_not_found');
    return fresh;
  });
  return { plan: toPlanView(updated, household) };
}

// ============================================================================
// Swap di uno slot, contorni
// ============================================================================

/**
 * Slot sostituibile del piano, oppure l'errore di dominio corrispondente. Un pasto con un piatto
 * bloccato è bloccato per intero. I giorni passati sono immutabili come nella rigenerazione.
 */
function findSwappableSlot(plan: PlanWithSlots, slotId: string, today: string): PlanSlotRecord {
  const slot = plan.slots.find((candidate) => candidate.id === slotId);
  if (!slot) throw new PlanError('slot_not_found');
  if (plan.slots.some((candidate) => sameMeal(candidate, slot) && candidate.locked)) {
    throw new PlanError('slot_locked');
  }
  if (slot.day < today) throw new PlanError('slot_past');
  return slot;
}

/** Ciò che cambia tra lo swap e le aggiunte di un contorno: controlli, portata e scrittura. */
interface DishFill {
  /** Controlli in più sullo slot di partenza, ripetuti sotto lock. Lanciano PlanError. */
  check: (plan: PlanWithSlots, slot: PlanSlotRecord) => void;
  /** Portata del piatto da riempire. */
  course: (slot: PlanSlotRecord) => Course;
  /** Scrive la ricetta scelta, dentro la transazione. */
  write: (tx: DbExecutor, slot: PlanSlotRecord, recipeId: string) => Promise<void>;
}

/**
 * Riempie un piatto (swap o nuovo contorno): ricetta scelta fuori dal lock, poi rifatta sotto
 * lock sullo stato riletto, così due richieste concorrenti non assegnano la stessa ricetta.
 * L'LLM interviene (fuori da transazioni) solo se la libreria non offre alternative.
 */
async function fillDish(
  planId: string,
  slotId: string,
  request: SwapSlotRequest,
  options: PlanServiceOptions,
  fill: DishFill
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
      slots: [{ key: slot.id, day: slot.day, meal: slot.meal, course: fill.course(slot) }],
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
  fill.check(plan, slot);

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
          courses: filterCourses(fill.course(slot)),
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
    fill.check(refreshed, refreshedSlot);
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
    fill.check(current, currentSlot);

    const constraints = await loadConstraints(household.id, tx);
    const recipeId = pickRecipe(current, currentSlot, await loadLibrary(tx), constraints);
    if (recipeId === null) throw llmError ?? new PlanError('no_alternatives');

    await fill.write(tx, currentSlot, recipeId);
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

/**
 * Sostituisce la ricetta di uno slot senza riproporre ricette del piano o già scartate. Il
 * piatto resta della sua portata: un principale cambia con un principale, un contorno con un contorno.
 */
export async function swapSlot(
  planId: string,
  slotId: string,
  request: SwapSlotRequest,
  options: PlanServiceOptions = {}
): Promise<PlanMutationResult> {
  return fillDish(planId, slotId, request, options, {
    check: () => undefined,
    course: (slot) => slot.course,
    write: (tx, slot, recipeId) => updateSlotRecipe(tx, slot.id, recipeId),
  });
}

function assertCanAddSide(plan: PlanWithSlots, slot: PlanSlotRecord): void {
  if (slot.course !== 'primo' && slot.course !== 'secondo') throw new PlanError('side_not_allowed');
  if (plan.slots.some((candidate) => sameMeal(candidate, slot) && candidate.course === 'contorno')) {
    throw new PlanError('side_exists');
  }
}

/**
 * Aggiunge un contorno al pasto dello slot principale indicato. Stesse regole dello swap.
 */
export async function addSideDish(
  planId: string,
  mainSlotId: string,
  request: SwapSlotRequest,
  options: PlanServiceOptions = {}
): Promise<PlanMutationResult> {
  return fillDish(planId, mainSlotId, request, options, {
    check: assertCanAddSide,
    course: () => 'contorno',
    write: (tx, slot, recipeId) =>
      insertSlots(tx, planId, [
        {
          day: slot.day,
          meal: slot.meal,
          course: 'contorno',
          recipe_id: recipeId,
          servings: slot.servings,
          locked: false,
        },
      ]),
  });
}

/** Toglie il contorno del pasto. Una sola transazione; la lista della spesa va rifatta. */
export async function removeSideDish(
  planId: string,
  sideSlotId: string,
  options: PlanServiceOptions = {}
): Promise<PlanResult> {
  const household = await loadHousehold(options.householdId);
  const { today, currentWeekStart } = resolveClock(options);

  const { updated, freshHousehold } = await db.transaction(async (tx) => {
    await acquirePlanLock(tx, household.id);
    const plan = await loadOpenOwnedPlan(tx, planId, household, currentWeekStart);
    const slot = findSwappableSlot(plan, sideSlotId, today);
    if (slot.course !== 'contorno') throw new PlanError('not_a_side_dish');

    await deleteSlots(tx, [slot.id]);
    await markShoppingListStale(tx, planId);

    const fresh = await getPlanById(tx, planId);
    if (!fresh) throw new PlanError('plan_not_found');
    const current = await getHouseholdById(household.id, tx);
    if (!current) throw new Error(`Household ${household.id} non trovato`);
    return { updated: fresh, freshHousehold: current };
  });

  return { plan: toPlanView(updated, freshHousehold) };
}

// ============================================================================
// Scelta a mano di una ricetta
// ============================================================================

/**
 * Ricette della libreria che si possono mettere a mano nello slot: non bloccate, del tipo
 * di pasto dello slot, che rispettano diete ed elettrodomestici. Gli ingredienti «non mi
 * piace» non le escludono. Manca quella già nello slot; l'ordine è quello della Libreria.
 * Il filtro segue il piatto: un contorno per il contorno, una qualsiasi principale per il principale.
 * Esclude anche la ricetta dell'altro piatto dello stesso pasto: non può essere principale e contorno insieme.
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
  const sibling = plan.slots.find((other) => other.id !== slot.id && sameMeal(other, slot));

  const library = await listRecipesWith(db, { household_id: household.id });
  const recipes = library
    .filter(
      (recipe) =>
        recipe.id !== slot.recipe_id &&
        recipe.id !== sibling?.recipe_id &&
        manualChoiceExclusionReason(recipe, slot.meal, courseFilterOf(slot), household) === null
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
 * e nessuna chiamata LLM. Un principale segue la portata della ricetta: con un contorno, un
 * primo o un secondo tiene il contorno; un piatto unico lo toglie. Tutto si rilegge sotto il
 * lock dei piani dell'household.
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
    if (manualChoiceExclusionReason(recipe, slot.meal, courseFilterOf(slot), current) !== null) {
      throw new PlanError('recipe_not_eligible');
    }
    // Il piatto gemello dello stesso pasto non può avere la stessa ricetta.
    const sibling = plan.slots.find((candidate) => candidate.id !== slot.id && sameMeal(candidate, slot));
    if (sibling?.recipe_id === recipeId) throw new PlanError('recipe_not_eligible');

    const side = plan.slots.find((candidate) => sameMeal(candidate, slot) && candidate.course === 'contorno');
    const course: Course =
      slot.course === 'contorno'
        ? slot.course
        : mainCourseForChoice(recipe.courses, slot.course, side !== undefined);

    // Richiesta ripetuta: la ricetta (e la portata) sono già quelle dello slot, niente da scrivere.
    if (slot.recipe_id === recipeId && course === slot.course) {
      return { updated: plan, freshHousehold: current };
    }

    await updateSlotRecipe(tx, slotId, recipeId, course);
    // Un piatto unico non ha contorno.
    if (course === 'piatto-unico' && side) await deleteSlots(tx, [side.id]);

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
