// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { mealCompositionOf } from '@/lib/domain/compositions';
import { PLANNER_CONFIG } from '@/lib/domain/planner-config';
import { createRng } from '@/lib/domain/rng';
import {
  DEFAULT_MEAL_COMPOSITIONS,
  MEAL_COMPOSITION_VALUES,
  type Course,
  type MealComposition,
  type MealCompositions,
  type MealType,
  type PlanView,
} from '@/lib/domain/types';
import { updateHousehold } from '@/lib/db/repositories/household-repo';
import { generatePlan, setSlotLock, type GenerateRecipesFn, type PlanServiceOptions } from '@/lib/plans/service';
import type { GenerateAndStoreInput } from '@/lib/recipes';
import { loadRecipePack } from '@/lib/recipes/pack/load';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
  TEST_MEAL_COMPOSITIONS,
} from '@/tests/helpers/db';
import { insertTestRecipes } from '@/tests/helpers/plans';

// Questo file fa più generazioni di piano per test sul database: nella suite completa, con i
// file in parallelo, i 5 s di default di Vitest non bastano sempre.
vi.setConfig({ testTimeout: 15_000 });

const MON = () => new Date('2026-09-28T08:00:00Z'); // settimana 28/09 completa: sette giorni
const DINNERS = 7;
const SILENT_LOGGER = { log: () => undefined };

const dbUp = await isDbAvailable();

type ViewSlot = PlanView['slots'][number];

/** Slot raggruppati per pasto (giorno + tipo), nell'ordine del piano. */
function byMeal(slots: readonly ViewSlot[]): ViewSlot[][] {
  const groups = new Map<string, ViewSlot[]>();
  for (const slot of slots) {
    const key = `${slot.day}|${slot.meal}`;
    groups.set(key, [...(groups.get(key) ?? []), slot]);
  }
  return [...groups.values()];
}

/** Composizione di ogni pasto, `null` se le portate non ne formano una. */
const compositionOfMeal = (slots: readonly ViewSlot[]): MealComposition | null =>
  mealCompositionOf(slots.map((slot) => slot.course));

describe.skipIf(!dbUp)('generatePlan con le composizioni del pasto', () => {
  let createdHouseholdIds: string[] = [];

  beforeAll(async () => {
    await assertDbMigrated();
  });

  afterEach(async () => {
    for (const id of createdHouseholdIds) {
      await deleteTestHousehold(id);
    }
    createdHouseholdIds = [];
  });

  /** Household con sole cene; pranzo con la composizione di test. */
  async function newHousehold(dinnerCompositions: MealComposition[]): Promise<string> {
    const meal_compositions: MealCompositions = {
      pranzo: [...TEST_MEAL_COMPOSITIONS.pranzo],
      cena: dinnerCompositions,
    };
    const id = await createTestHousehold({ meals: ['cena'] as MealType[], meal_compositions });
    createdHouseholdIds.push(id);
    return id;
  }

  async function libraryPerCourse(householdId: string, count: number): Promise<void> {
    const courses: Course[] = ['piatto-unico', 'primo', 'secondo', 'contorno'];
    for (const course of courses) {
      await insertTestRecipes(householdId, count, { meal_types: ['cena'], courses: [course] });
    }
  }

  /** `generate` finto che crea ricette della portata richiesta. */
  function creatingGenerate() {
    return vi.fn<GenerateRecipesFn>(async (input: GenerateAndStoreInput) => ({
      requested: input.count,
      created: await insertTestRecipes(input.householdId!, input.count, {
        meal_types: [input.mealType ?? 'cena'],
        courses: [...(input.courses ?? [])],
      }),
      skipped: [],
    }));
  }

  function neverGenerate() {
    return vi
      .fn<GenerateRecipesFn>()
      .mockRejectedValue(new Error('generate non doveva essere chiamato'));
  }

  function opts(
    householdId: string,
    now: () => Date,
    generate: GenerateRecipesFn = neverGenerate(),
    extra: Partial<PlanServiceOptions> = {}
  ): PlanServiceOptions {
    return { householdId, now, rng: createRng(1), generate, ...extra };
  }

  function shownPlan(screen: Awaited<ReturnType<typeof generatePlan>>['screen']) {
    const plan = screen.view.plan;
    if (!plan) throw new Error('nessun piano mostrato');
    return plan;
  }

  it('composes every dinner from the admitted compositions, balanced over the week, with zero LLM calls', async () => {
    const householdId = await newHousehold([...MEAL_COMPOSITION_VALUES]);
    await libraryPerCourse(householdId, 10);
    const generate = neverGenerate();

    const plan = shownPlan((await generatePlan(opts(householdId, MON, generate))).screen);

    expect(generate).not.toHaveBeenCalled();
    const meals = byMeal(plan.slots);
    expect(meals).toHaveLength(DINNERS);
    const compositions = meals.map(compositionOfMeal);
    expect(compositions.every((composition) => composition !== null)).toBe(true);
    const counts = MEAL_COMPOSITION_VALUES.map(
      (composition) => compositions.filter((c) => c === composition).length
    );
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    for (const slot of plan.slots) {
      expect(slot.recipe!.courses).toContain(slot.course);
    }
    const ids = plan.slots.map((slot) => slot.recipe!.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('makes every dinner a secondo with a contorno when that is the only admitted composition', async () => {
    const householdId = await newHousehold(['secondo-contorno']);
    await insertTestRecipes(householdId, 10, { meal_types: ['cena'], courses: ['secondo'] });
    await insertTestRecipes(householdId, 10, { meal_types: ['cena'], courses: ['contorno'] });

    const plan = shownPlan((await generatePlan(opts(householdId, MON, neverGenerate()))).screen);

    expect(plan.slots).toHaveLength(DINNERS * 2);
    for (const meal of byMeal(plan.slots)) {
      expect(meal.map((slot) => slot.course).sort()).toEqual(['contorno', 'secondo']);
    }
  });

  it('asks the model only for contorni, when the library has too few side dishes', async () => {
    const householdId = await newHousehold(['secondo-contorno']);
    await insertTestRecipes(householdId, 12, { meal_types: ['cena'], courses: ['secondo'] });
    await insertTestRecipes(householdId, 5, { meal_types: ['cena'], courses: ['contorno'] });
    const generate = creatingGenerate();

    const plan = shownPlan((await generatePlan(opts(householdId, MON, generate))).screen);

    expect(generate).toHaveBeenCalled();
    for (const [input] of generate.mock.calls) {
      expect(input.mealType).toBe('cena');
      expect(input.courses).toEqual(['contorno']);
    }
    expect(plan.slots.filter((slot) => slot.course === 'contorno')).toHaveLength(DINNERS);
    for (const slot of plan.slots) {
      expect(slot.recipe!.courses).toContain(slot.course);
    }
  });

  it('asks for at most generationMax recipes per meal type in one round, even with several course groups short', async () => {
    const householdId = await newHousehold([...MEAL_COMPOSITION_VALUES]);
    const generate = vi.fn<GenerateRecipesFn>(async (input: GenerateAndStoreInput) => ({
      requested: input.count,
      created: [],
      skipped: [],
    }));

    await expect(generatePlan(opts(householdId, MON, generate))).rejects.toMatchObject({
      code: 'insufficient_recipes',
    });

    const requested = generate.mock.calls.reduce((sum, [input]) => sum + input.count, 0);
    const groups = new Set(generate.mock.calls.map(([input]) => input.courses?.join('|')));
    expect(requested).toBeGreaterThan(0);
    expect(groups.size).toBeGreaterThan(1);
    expect(requested).toBeLessThanOrEqual(PLANNER_CONFIG.generationMax);
  });

  it('keeps a locked secondo with contorno identical when the plan is regenerated', async () => {
    const householdId = await newHousehold(['secondo-contorno']);
    await libraryPerCourse(householdId, 10);
    const first = shownPlan((await generatePlan(opts(householdId, MON, neverGenerate()))).screen);
    const lockedDay = first.slots[0].day;
    const before = first.slots.filter((slot) => slot.day === lockedDay);
    expect(before).toHaveLength(2);
    await setSlotLock(first.id, before[0].id, true, opts(householdId, MON));

    // Dopo il blocco le composizioni ammesse diventano tutte: il pasto bloccato non cambia.
    await updateHousehold({ meal_compositions: DEFAULT_MEAL_COMPOSITIONS }, householdId);
    const second = shownPlan((await generatePlan(opts(householdId, MON, neverGenerate()))).screen);

    const after = second.slots.filter((slot) => slot.day === lockedDay);
    expect(after.map((slot) => slot.id).sort()).toEqual(before.map((slot) => slot.id).sort());
    for (const slot of after) {
      const previous = before.find((b) => b.id === slot.id)!;
      expect(slot.recipe!.id).toBe(previous.recipe!.id);
      expect(slot.locked).toBe(true);
    }
    const secondMeals = byMeal(second.slots);
    expect(secondMeals).toHaveLength(DINNERS);
    expect(secondMeals.every((meal) => compositionOfMeal(meal) !== null)).toBe(true);
  });

  it('builds a full plan from the recipe pack with the default compositions and zero LLM calls', async () => {
    const householdId = await createTestHousehold({
      meals: ['pranzo', 'cena'],
      meal_compositions: DEFAULT_MEAL_COMPOSITIONS,
    });
    createdHouseholdIds.push(householdId);
    await loadRecipePack({ householdId, logger: SILENT_LOGGER });
    const generate = neverGenerate();

    const plan = shownPlan((await generatePlan(opts(householdId, MON, generate))).screen);

    expect(generate).not.toHaveBeenCalled();
    const meals = byMeal(plan.slots);
    expect(meals).toHaveLength(DINNERS * 2);
    expect(meals.every((meal) => compositionOfMeal(meal) !== null)).toBe(true);
    const ids = plan.slots.map((slot) => slot.recipe!.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, 60_000);
});
