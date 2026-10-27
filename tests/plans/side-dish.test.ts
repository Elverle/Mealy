// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { db, shopping_lists } from '@/lib/db';
import { insertPlan, insertSlots, getPlanById, type PlanWithSlots } from '@/lib/db/repositories/plan-repo';
import { getRecipeById, type RecipeWithDetails } from '@/lib/db/repositories/recipe-repo';
import { createRng } from '@/lib/domain/rng';
import type { Course, MealType } from '@/lib/domain/types';
import {
  addSideDish,
  assignSlotRecipe,
  confirmPlan,
  listSlotCandidates,
  removeSideDish,
  setSlotLock,
  swapSlot,
  type GenerateRecipesFn,
  type PlanServiceOptions,
} from '@/lib/plans/service';
import { buildPlanShoppingList } from '@/lib/shopping/service';
import type { GenerateAndStoreInput } from '@/lib/recipes';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { insertTestRecipe, insertTestRecipes } from '@/tests/helpers/plans';

// Questo file fa più generazioni di piano per test sul database: nella suite completa, con i
// file in parallelo, i 5 s di default di Vitest non bastano sempre.
vi.setConfig({ testTimeout: 15_000 });

const WED = () => new Date('2026-09-30T10:00:00Z'); // settimana 28/09, dal 30/09
const DAY = '2026-09-30';
const PAST_DAY = '2026-09-28';
const OTHER_DAY = '2026-10-01';
const MEAL: MealType = 'cena';
const SERVINGS = 2;
const NO_EXCLUSIONS = { exclude_recipe_ids: [] as string[] };

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('contorni e portate nei piani', () => {
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

  /** Household con sole cene (composizione di test: un piatto per pasto). */
  async function dinnerHousehold(): Promise<string> {
    const id = await createTestHousehold({ meals: [MEAL] });
    createdHouseholdIds.push(id);
    return id;
  }

  /** `generate` che non deve essere chiamato. */
  function neverGenerate() {
    return vi
      .fn<GenerateRecipesFn>()
      .mockRejectedValue(new Error('generate non doveva essere chiamato'));
  }

  /** `generate` finto: crea ricette con la portata e il tipo richiesti. */
  function creatingGenerate() {
    return vi.fn<GenerateRecipesFn>(async (input: GenerateAndStoreInput) => ({
      requested: input.count,
      created: await insertTestRecipes(input.householdId!, input.count, {
        meal_types: [input.mealType ?? MEAL],
        courses: [...(input.courses ?? [])],
      }),
      skipped: [],
    }));
  }

  function opts(
    householdId: string,
    now: () => Date,
    generate: GenerateRecipesFn = neverGenerate()
  ): PlanServiceOptions {
    return { householdId, now, rng: createRng(1), generate };
  }

  /** Piano (settimana 28/09) con gli slot dati, scritti direttamente come farebbe la generazione. */
  async function writePlan(
    householdId: string,
    slots: {
      day?: string;
      course: Course;
      recipe: RecipeWithDetails | null;
      locked?: boolean;
    }[]
  ): Promise<PlanWithSlots> {
    const plan = await insertPlan(db, householdId, '2026-09-28');
    await insertSlots(
      db,
      plan.id,
      slots.map((slot) => ({
        day: slot.day ?? DAY,
        meal: MEAL,
        course: slot.course,
        recipe_id: slot.recipe?.id ?? null,
        servings: SERVINGS,
        locked: slot.locked ?? false,
      }))
    );
    return (await getPlanById(db, plan.id))!;
  }

  const slotOf = (plan: PlanWithSlots, course: Course) => plan.slots.find((s) => s.course === course)!;

  it('adds a contorno to a secondo: same day and meal, same servings, shopping list flagged', async () => {
    const householdId = await dinnerHousehold();
    const main = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo'] });
    const side = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['contorno'] });
    const plan = await writePlan(householdId, [{ course: 'secondo', recipe: main }]);
    await db.insert(shopping_lists).values({ plan_id: plan.id });
    const mainSlot = slotOf(plan, 'secondo');

    const result = await addSideDish(plan.id, mainSlot.id, NO_EXCLUSIONS, opts(householdId, WED));

    expect(result.plan.slots).toHaveLength(2);
    const sideSlot = result.plan.slots.find((s) => s.course === 'contorno')!;
    expect(sideSlot).toMatchObject({ day: DAY, meal: MEAL, servings: SERVINGS, locked: false });
    expect(sideSlot.recipe!.id).toBe(side.id);
    expect(result.plan.slots.find((s) => s.id === mainSlot.id)!.recipe!.id).toBe(main.id);
    expect(result.plan.shopping_list).toEqual({ exists: true, needs_regeneration: true });
    expect(result.generation).toEqual({ rounds: 0, created: 0, failed: false });
  });

  it('on a confirmed plan counts the usage of the side dish at the meal day', async () => {
    const householdId = await dinnerHousehold();
    const main = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo'] });
    const side = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['contorno'] });
    const plan = await writePlan(householdId, [{ course: 'secondo', recipe: main }]);
    await confirmPlan(plan.id, opts(householdId, WED));

    const result = await addSideDish(plan.id, slotOf(plan, 'secondo').id, NO_EXCLUSIONS, opts(householdId, WED));

    expect(result.plan.status).toBe('active');
    const fresh = (await getRecipeById(side.id))!;
    expect(fresh.prefs?.times_used).toBe(1);
    expect(fresh.prefs?.last_used_at?.toISOString()).toBe(`${DAY}T12:00:00.000Z`);
  });

  it('refuses a side on a piatto unico and on a side dish itself, with side_not_allowed', async () => {
    const householdId = await dinnerHousehold();
    await insertTestRecipes(householdId, 3, { meal_types: [MEAL], courses: ['contorno'] });
    const single = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['piatto-unico'] });
    const sideOnly = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['contorno'] });
    const plan = await writePlan(householdId, [{ course: 'piatto-unico', recipe: single }]);

    await expect(
      addSideDish(plan.id, slotOf(plan, 'piatto-unico').id, NO_EXCLUSIONS, opts(householdId, WED))
    ).rejects.toMatchObject({ code: 'side_not_allowed' });

    // Un piano per household e settimana: il contorno da solo sta in un altro household.
    const otherHouseholdId = await dinnerHousehold();
    const sidePlan = await writePlan(otherHouseholdId, [{ course: 'contorno', recipe: sideOnly }]);
    await expect(
      addSideDish(sidePlan.id, slotOf(sidePlan, 'contorno').id, NO_EXCLUSIONS, opts(otherHouseholdId, WED))
    ).rejects.toMatchObject({ code: 'side_not_allowed' });
  });

  it('refuses a second contorno on a meal that already has one, with side_exists', async () => {
    const householdId = await dinnerHousehold();
    const main = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['primo'] });
    const side = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['contorno'] });
    await insertTestRecipes(householdId, 2, { meal_types: [MEAL], courses: ['contorno'] });
    const plan = await writePlan(householdId, [
      { course: 'primo', recipe: main },
      { course: 'contorno', recipe: side },
    ]);

    await expect(
      addSideDish(plan.id, slotOf(plan, 'primo').id, NO_EXCLUSIONS, opts(householdId, WED))
    ).rejects.toMatchObject({ code: 'side_exists' });
  });

  it('refuses a side on a locked meal with slot_locked, and on a past day with slot_past', async () => {
    const householdId = await dinnerHousehold();
    await insertTestRecipes(householdId, 3, { meal_types: [MEAL], courses: ['contorno'] });
    const main = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo'] });
    const locked = await writePlan(householdId, [{ course: 'secondo', recipe: main, locked: true }]);
    await expect(
      addSideDish(locked.id, slotOf(locked, 'secondo').id, NO_EXCLUSIONS, opts(householdId, WED))
    ).rejects.toMatchObject({ code: 'slot_locked' });

    const pastHouseholdId = await dinnerHousehold();
    await insertTestRecipes(pastHouseholdId, 3, { meal_types: [MEAL], courses: ['contorno'] });
    const pastMain = await insertTestRecipe(pastHouseholdId, { meal_types: [MEAL], courses: ['secondo'] });
    const past = await writePlan(pastHouseholdId, [{ course: 'secondo', recipe: pastMain, day: PAST_DAY }]);
    await expect(
      addSideDish(past.id, slotOf(past, 'secondo').id, NO_EXCLUSIONS, opts(pastHouseholdId, WED))
    ).rejects.toMatchObject({ code: 'slot_past' });
  });

  it('generates the side dish asking for contorno only, when the library has none', async () => {
    const householdId = await dinnerHousehold();
    await insertTestRecipes(householdId, 2, { meal_types: [MEAL], courses: ['piatto-unico'] });
    const main = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo'] });
    const plan = await writePlan(householdId, [{ course: 'secondo', recipe: main }]);
    const generate = creatingGenerate();

    const result = await addSideDish(plan.id, slotOf(plan, 'secondo').id, NO_EXCLUSIONS, opts(householdId, WED, generate));

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith({
      householdId,
      count: 3,
      mealType: MEAL,
      courses: ['contorno'],
    });
    const sideSlot = result.plan.slots.find((s) => s.course === 'contorno')!;
    expect(sideSlot.recipe!.courses).toEqual(['contorno']);
    expect(result.generation).toEqual({ rounds: 1, created: 3, failed: false });
  });

  it('removes a contorno, and refuses to remove a main dish with not_a_side_dish', async () => {
    const householdId = await dinnerHousehold();
    const main = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo'] });
    const side = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['contorno'] });
    const plan = await writePlan(householdId, [
      { course: 'secondo', recipe: main },
      { course: 'contorno', recipe: side },
    ]);

    await expect(
      removeSideDish(plan.id, slotOf(plan, 'secondo').id, opts(householdId, WED))
    ).rejects.toMatchObject({ code: 'not_a_side_dish' });

    const result = await removeSideDish(plan.id, slotOf(plan, 'contorno').id, opts(householdId, WED));
    expect(result.plan.slots).toHaveLength(1);
    expect(result.plan.slots[0]).toMatchObject({ id: slotOf(plan, 'secondo').id, course: 'secondo' });
  });

  it('assigns a piatto unico to a secondo with contorno: the side dish is dropped', async () => {
    const householdId = await dinnerHousehold();
    const main = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo'] });
    const side = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['contorno'] });
    const single = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['piatto-unico'] });
    const plan = await writePlan(householdId, [
      { course: 'secondo', recipe: main },
      { course: 'contorno', recipe: side },
    ]);

    const result = await assignSlotRecipe(plan.id, slotOf(plan, 'secondo').id, single.id, opts(householdId, WED));

    expect(result.plan.slots).toHaveLength(1);
    expect(result.plan.slots[0]).toMatchObject({ course: 'piatto-unico' });
    expect(result.plan.slots[0].recipe!.id).toBe(single.id);
  });

  it('assigns a primo to a secondo with contorno: the main becomes primo and the side is kept', async () => {
    const householdId = await dinnerHousehold();
    const main = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo'] });
    const side = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['contorno'] });
    const primo = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['primo'] });
    const plan = await writePlan(householdId, [
      { course: 'secondo', recipe: main },
      { course: 'contorno', recipe: side },
    ]);

    const result = await assignSlotRecipe(plan.id, slotOf(plan, 'secondo').id, primo.id, opts(householdId, WED));

    expect(result.plan.slots.map((s) => s.course).sort()).toEqual(['contorno', 'primo']);
    expect(result.plan.slots.find((s) => s.course === 'primo')!.recipe!.id).toBe(primo.id);
    expect(result.plan.slots.find((s) => s.course === 'contorno')!.recipe!.id).toBe(side.id);
  });

  it('lists every main course on a main slot and only sides on a side slot', async () => {
    const householdId = await dinnerHousehold();
    const main = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo'] });
    const side = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['contorno'] });
    const otherSide = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['contorno'] });
    const single = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['piatto-unico'] });
    const primo = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['primo'] });
    const plan = await writePlan(householdId, [
      { course: 'secondo', recipe: main },
      { course: 'contorno', recipe: side },
    ]);

    const onMain = (await listSlotCandidates(plan.id, slotOf(plan, 'secondo').id, opts(householdId, WED))).recipes.map((r) => r.id);
    expect(onMain).toEqual(expect.arrayContaining([single.id, primo.id]));
    expect(onMain).not.toContain(otherSide.id);
    expect(onMain).not.toContain(side.id);
    expect(onMain).not.toContain(main.id);

    const onSide = (await listSlotCandidates(plan.id, slotOf(plan, 'contorno').id, opts(householdId, WED))).recipes.map((r) => r.id);
    expect(onSide).toEqual([otherSide.id]);
  });

  it('locking the side dish locks the whole meal', async () => {
    const householdId = await dinnerHousehold();
    const main = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo'] });
    const side = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['contorno'] });
    const plan = await writePlan(householdId, [
      { course: 'secondo', recipe: main },
      { course: 'contorno', recipe: side },
    ]);

    const result = await setSlotLock(plan.id, slotOf(plan, 'contorno').id, true, opts(householdId, WED));

    expect(result.plan.slots.every((s) => s.locked)).toBe(true);
  });

  it('swaps the side dish for another contorno, leaving the main dish untouched', async () => {
    const householdId = await dinnerHousehold();
    const main = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo'] });
    const side = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['contorno'] });
    const others = await insertTestRecipes(householdId, 2, { meal_types: [MEAL], courses: ['contorno'] });
    const plan = await writePlan(householdId, [
      { course: 'secondo', recipe: main },
      { course: 'contorno', recipe: side },
    ]);

    const result = await swapSlot(plan.id, slotOf(plan, 'contorno').id, NO_EXCLUSIONS, opts(householdId, WED));

    const newSide = result.plan.slots.find((s) => s.course === 'contorno')!.recipe!.id;
    expect(others.map((r) => r.id)).toContain(newSide);
    expect(result.plan.slots.find((s) => s.course === 'secondo')!.recipe!.id).toBe(main.id);
  });

  /** Slot del piano (id, portata, ricetta) ordinati per id: per dire che il piano non è cambiato. */
  async function slotState(planId: string) {
    const plan = (await getPlanById(db, planId))!;
    return plan.slots
      .map((slot) => ({ id: slot.id, course: slot.course, recipe_id: slot.recipe_id }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  it('refuses to put on the side the recipe already served as main of the same meal, with recipe_not_eligible', async () => {
    const householdId = await dinnerHousehold();
    const both = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo', 'contorno'] });
    const other = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['contorno'] });
    const plan = await writePlan(householdId, [
      { course: 'secondo', recipe: both },
      { course: 'contorno', recipe: other },
    ]);
    const before = await slotState(plan.id);

    await expect(
      assignSlotRecipe(plan.id, slotOf(plan, 'contorno').id, both.id, opts(householdId, WED))
    ).rejects.toMatchObject({ code: 'recipe_not_eligible' });
    expect(await slotState(plan.id)).toEqual(before);
  });

  it('refuses to put on the main the recipe already served as side of the same meal, with recipe_not_eligible', async () => {
    const householdId = await dinnerHousehold();
    const both = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo', 'contorno'] });
    const main = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo'] });
    const plan = await writePlan(householdId, [
      { course: 'secondo', recipe: main },
      { course: 'contorno', recipe: both },
    ]);
    const before = await slotState(plan.id);

    await expect(
      assignSlotRecipe(plan.id, slotOf(plan, 'secondo').id, both.id, opts(householdId, WED))
    ).rejects.toMatchObject({ code: 'recipe_not_eligible' });
    expect(await slotState(plan.id)).toEqual(before);
  });

  it('does not list, on a side or on a main, the recipe of the other dish of the same meal', async () => {
    const householdId = await dinnerHousehold();
    const mainBoth = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo', 'contorno'] });
    const sideBoth = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo', 'contorno'] });
    const otherSide = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['contorno'] });
    const otherMain = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo'] });
    const plan = await writePlan(householdId, [
      { course: 'secondo', recipe: mainBoth },
      { course: 'contorno', recipe: sideBoth },
    ]);

    const onSide = (await listSlotCandidates(plan.id, slotOf(plan, 'contorno').id, opts(householdId, WED))).recipes.map((r) => r.id);
    expect(onSide).toContain(otherSide.id);
    expect(onSide).not.toContain(mainBoth.id);

    const onMain = (await listSlotCandidates(plan.id, slotOf(plan, 'secondo').id, opts(householdId, WED))).recipes.map((r) => r.id);
    expect(onMain).toContain(otherMain.id);
    expect(onMain).not.toContain(sideBoth.id);
  });

  it('still lists and accepts, flagged as in plan, a recipe used in another meal of the plan', async () => {
    const householdId = await dinnerHousehold();
    const main = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo'] });
    const side = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['contorno'] });
    const elsewhere = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo', 'contorno'] });
    const plan = await writePlan(householdId, [
      { course: 'secondo', recipe: main },
      { course: 'contorno', recipe: side },
      { course: 'secondo', recipe: elsewhere, day: OTHER_DAY },
    ]);
    const sideSlot = plan.slots.find((s) => s.day === DAY && s.course === 'contorno')!;

    const candidates = await listSlotCandidates(plan.id, sideSlot.id, opts(householdId, WED));
    expect(candidates.recipes.map((r) => r.id)).toContain(elsewhere.id);
    expect(candidates.in_plan_recipe_ids).toContain(elsewhere.id);

    const result = await assignSlotRecipe(plan.id, sideSlot.id, elsewhere.id, opts(householdId, WED));
    expect(result.plan.slots.find((s) => s.id === sideSlot.id)!.recipe!.id).toBe(elsewhere.id);
  });

  it('the shopping list of a confirmed plan includes the ingredients of the side dish', async () => {
    const householdId = await dinnerHousehold();
    const main = await insertTestRecipe(householdId, { meal_types: [MEAL], courses: ['secondo'] });
    const side = await insertTestRecipe(householdId, {
      meal_types: [MEAL],
      courses: ['contorno'],
      ingredients: [
        { canonical_name: 'fagiolini', display_name: 'fagiolini', qty: null, unit: 'qb', category: 'ortofrutta' },
      ],
    });
    const plan = await writePlan(householdId, [
      { course: 'secondo', recipe: main },
      { course: 'contorno', recipe: side },
    ]);
    await confirmPlan(plan.id, opts(householdId, WED));

    const view = await buildPlanShoppingList(plan.id, opts(householdId, WED));

    const names = view.list?.items.map((item) => item.canonical_name) ?? [];
    expect(names).toContain('fagiolini');
  });
});
