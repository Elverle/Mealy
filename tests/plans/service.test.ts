// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { db } from '@/lib/db';
import {
  archivePlansBefore,
  findPlanByWeek,
  insertPlan,
  insertSlots,
} from '@/lib/db/repositories/plan-repo';
import { getRecipeById } from '@/lib/db/repositories/recipe-repo';
import { updateHousehold } from '@/lib/db/repositories/household-repo';
import { PLANNER_CONFIG } from '@/lib/domain/planner-config';
import { createRng } from '@/lib/domain/rng';
import type { MealType } from '@/lib/domain/types';
import { LlmError } from '@/lib/llm/errors';
import {
  confirmPlan,
  generatePlan,
  getPlanScreen,
  isPlanClosed,
  setSlotLock,
  type GenerateRecipesFn,
  type PlanServiceOptions,
} from '@/lib/plans/service';
import type { GenerateAndStoreInput } from '@/lib/recipes';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { insertTestRecipes } from '@/tests/helpers/plans';

const WED = () => new Date('2026-09-30T10:00:00Z'); // settimana 28/09, dal 30/09: 5 giorni
const SAT = () => new Date('2026-10-03T09:00:00Z'); // obiettivo: settimana 05/10, completa
const MON = () => new Date('2026-09-28T08:00:00Z');
const MON2 = () => new Date('2026-10-05T08:00:00Z'); // lunedì dopo SAT

const WED_DAYS = ['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
const BOTH_MEALS: MealType[] = ['pranzo', 'cena'];

// Pool minimo enorme: il planner chiede sempre nuove ricette, così l'LLM (finto) gira davvero.
const FORCE_GENERATION_CONFIG = { ...PLANNER_CONFIG, minPoolSize: 20 };

const dbUp = await isDbAvailable();

describe('isPlanClosed', () => {
  it('closes archived plans and plans of concluded weeks only', () => {
    expect(isPlanClosed({ status: 'archived', week_start: '2026-09-28' }, '2026-09-28')).toBe(true);
    expect(isPlanClosed({ status: 'active', week_start: '2026-09-21' }, '2026-09-28')).toBe(true);
    expect(isPlanClosed({ status: 'draft', week_start: '2026-09-28' }, '2026-09-28')).toBe(false);
    expect(isPlanClosed({ status: 'active', week_start: '2026-10-05' }, '2026-09-28')).toBe(false);
  });
});

describe.skipIf(!dbUp)('plan service', () => {
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

  async function newHousehold(meals: MealType[] = BOTH_MEALS, persons?: number): Promise<string> {
    const id = await createTestHousehold({ meals, ...(persons ? { persons } : {}) });
    createdHouseholdIds.push(id);
    return id;
  }

  /** Household con una libreria ricca: `perMeal` ricette solo pranzo e `perMeal` solo cena. */
  async function richHousehold(perMeal = 12, meals: MealType[] = BOTH_MEALS): Promise<string> {
    const id = await newHousehold(meals);
    if (meals.includes('pranzo')) await insertTestRecipes(id, perMeal, { meal_types: ['pranzo'] });
    if (meals.includes('cena')) await insertTestRecipes(id, perMeal, { meal_types: ['cena'] });
    return id;
  }

  /** `generate` finto: crea `perCall(count)` ricette del tipo richiesto (default: `count`). */
  function fakeGenerate(perCall: (count: number) => number = (count) => count) {
    return vi.fn<GenerateRecipesFn>(async (input: GenerateAndStoreInput) => {
      const created = input.mealType
        ? await insertTestRecipes(input.householdId!, perCall(input.count), {
            meal_types: [input.mealType],
          })
        : [];
      return { requested: input.count, created, skipped: [] };
    });
  }

  function neverGenerate() {
    return vi.fn<GenerateRecipesFn>().mockRejectedValue(new Error('generate non doveva essere chiamato'));
  }

  function opts(
    householdId: string,
    now: () => Date,
    generate: GenerateRecipesFn = neverGenerate(),
    extra: Partial<PlanServiceOptions> = {}
  ): PlanServiceOptions {
    return { householdId, now, rng: createRng(1), generate, ...extra };
  }

  function shownPlan(screen: Awaited<ReturnType<typeof getPlanScreen>>) {
    const plan = screen.view.plan;
    if (!plan) throw new Error('nessun piano mostrato');
    return plan;
  }

  const recipeIds = (plan: { slots: { recipe: { id: string } | null }[] }): string[] =>
    plan.slots.map((slot) => slot.recipe!.id);

  it('builds a full plan from a rich library with zero LLM calls', async () => {
    const householdId = await richHousehold();
    const generate = neverGenerate();

    const { screen, generation } = await generatePlan(opts(householdId, WED, generate));

    expect(generate).not.toHaveBeenCalled();
    const plan = shownPlan(screen);
    expect(plan.slots).toHaveLength(10);
    expect([...new Set(plan.slots.map((s) => s.day))]).toEqual(WED_DAYS);
    const ids = recipeIds(plan);
    expect(new Set(ids).size).toBe(10);
    expect(plan.slots.every((s) => s.servings === 2)).toBe(true);
    expect(plan.status).toBe('draft');
    expect(screen.view.action).toBe('regenerate');
    expect(generation).toEqual({ rounds: 0, created: 0, failed: false });
  });

  it('generates in parallel batches of 3 from an empty library', async () => {
    const householdId = await newHousehold();
    const generate = fakeGenerate();

    const { screen, generation } = await generatePlan(opts(householdId, WED, generate));

    expect(generate).toHaveBeenCalledTimes(6);
    for (const [input] of generate.mock.calls) {
      expect(input).toMatchObject({ householdId, count: 3 });
    }
    const meals = generate.mock.calls.map(([input]) => input.mealType);
    expect(meals.filter((m) => m === 'pranzo')).toHaveLength(3);
    expect(meals.filter((m) => m === 'cena')).toHaveLength(3);
    expect(shownPlan(screen).slots).toHaveLength(10);
    expect(generation).toEqual({ rounds: 1, created: 18, failed: false });
  });

  it('splits a count of 10 into batches [3,3,3,1]', async () => {
    const householdId = await newHousehold(['cena']);
    const generate = fakeGenerate();

    const { screen, generation } = await generatePlan(opts(householdId, SAT, generate));

    const counts = generate.mock.calls.map(([input]) => input.count);
    expect(counts).toEqual([3, 3, 3, 1]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(shownPlan(screen).slots).toHaveLength(7);
    expect(generation).toEqual({ rounds: 1, created: 10, failed: false });
  });

  it('stops at maxGenerationRoundsPlan rounds even if the library is still short', async () => {
    const householdId = await newHousehold(['cena']);
    const generate = fakeGenerate(() => 1);

    const { screen, generation } = await generatePlan(opts(householdId, WED, generate));

    // giro 1: 5 slot, 0 ricette -> count 9 -> 3 lotti; giro 2: 3 ricette -> count 6 -> 2 lotti
    expect(generate.mock.calls.map(([input]) => input.count)).toEqual([3, 3, 3, 3, 3]);
    expect(generation.rounds).toBe(2);
    expect(generation).toMatchObject({ created: 5, failed: false });
    expect(shownPlan(screen).slots).toHaveLength(5);
  });

  it('still creates the plan when the LLM fails but the library is enough', async () => {
    const householdId = await newHousehold(['cena']);
    await insertTestRecipes(householdId, 6, { meal_types: ['cena'] });
    const generate = vi.fn<GenerateRecipesFn>().mockRejectedValue(new LlmError('provider', 'x'));

    const { screen, generation } = await generatePlan(opts(householdId, WED, generate));

    expect(shownPlan(screen).slots).toHaveLength(5);
    expect(generation).toEqual({ rounds: 1, created: 0, failed: true });
  });

  it('rethrows the LlmError and writes nothing when the LLM fails and the library is short', async () => {
    const householdId = await newHousehold(['cena']);
    await insertTestRecipes(householdId, 3, { meal_types: ['cena'] });
    const error = new LlmError('provider', 'x');
    const generate = vi.fn<GenerateRecipesFn>().mockRejectedValue(error);

    await expect(generatePlan(opts(householdId, WED, generate))).rejects.toBe(error);

    expect(await findPlanByWeek(db, householdId, '2026-09-28')).toBeNull();
  });

  it('throws insufficient_recipes and writes nothing when generation yields no recipes', async () => {
    const householdId = await newHousehold(['cena']);
    await insertTestRecipes(householdId, 3, { meal_types: ['cena'] });
    const generate = vi
      .fn<GenerateRecipesFn>()
      .mockResolvedValue({ requested: 3, created: [], skipped: [] });

    await expect(generatePlan(opts(householdId, WED, generate))).rejects.toMatchObject({
      name: 'PlanError',
      code: 'insufficient_recipes',
    });

    expect(await findPlanByWeek(db, householdId, '2026-09-28')).toBeNull();
  });

  it('rethrows a non-LLM error from generation as is', async () => {
    const householdId = await newHousehold(['cena']);
    const error = new Error('db');
    const generate = vi.fn<GenerateRecipesFn>().mockRejectedValue(error);

    await expect(generatePlan(opts(householdId, WED, generate))).rejects.toBe(error);
  });

  it('on weekends plans next week, archiving only concluded weeks', async () => {
    const householdId = await richHousehold();
    await insertPlan(db, householdId, '2026-09-28');
    await insertPlan(db, householdId, '2026-09-21');

    const { screen } = await generatePlan(opts(householdId, SAT));

    const plan = shownPlan(screen);
    expect(plan.week_start).toBe('2026-10-05');
    expect(plan.slots).toHaveLength(14);
    expect((await findPlanByWeek(db, householdId, '2026-09-28'))!.status).toBe('draft');
    expect((await findPlanByWeek(db, householdId, '2026-09-21'))!.status).toBe('archived');
  });

  it('regenerates keeping past days and locked slots, then applies new persons and meals', async () => {
    const householdId = await richHousehold();
    const first = await generatePlan(opts(householdId, MON));
    const firstPlan = shownPlan(first.screen);
    expect(firstPlan.slots).toHaveLength(14);
    const lockedSlot = firstPlan.slots.find((s) => s.day === '2026-10-01' && s.meal === 'cena')!;
    await setSlotLock(firstPlan.id, lockedSlot.id, true, opts(householdId, MON));

    const second = await generatePlan(opts(householdId, WED));

    const secondPlan = shownPlan(second.screen);
    expect(secondPlan.id).toBe(firstPlan.id);
    expect(secondPlan.slots).toHaveLength(14);
    const keptIds = new Set(
      firstPlan.slots
        .filter((s) => s.day < '2026-09-30' || s.id === lockedSlot.id)
        .map((s) => s.id)
    );
    expect(keptIds.size).toBe(5);
    for (const before of firstPlan.slots.filter((s) => keptIds.has(s.id))) {
      const after = secondPlan.slots.find((s) => s.id === before.id)!;
      expect(after.recipe!.id).toBe(before.recipe!.id);
    }
    const replaced = secondPlan.slots.filter((s) => !keptIds.has(s.id));
    expect(replaced).toHaveLength(9);
    expect(replaced.every((s) => !firstPlan.slots.some((b) => b.id === s.id))).toBe(true);
    expect(new Set(recipeIds(secondPlan)).size).toBe(14);
    expect(new Date(secondPlan.generated_at).getTime()).toBeGreaterThan(
      new Date(firstPlan.generated_at).getTime()
    );

    // Porzioni e pasti aggiornati (stesso `it`: gli household si eliminano in afterEach).
    await updateHousehold({ persons: 4, meals: ['cena'] }, householdId);
    const third = shownPlan((await generatePlan(opts(householdId, WED))).screen);

    const future = third.slots.filter((s) => s.day >= '2026-09-30');
    expect(future.every((s) => s.meal === 'cena' && s.servings === 4)).toBe(true);
    expect(future.map((s) => s.day)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(future.find((s) => s.id === lockedSlot.id)!.locked).toBe(true);
    const past = third.slots.filter((s) => s.day < '2026-09-30');
    expect(past).toHaveLength(4);
    expect(past.every((s) => s.servings === 2)).toBe(true);
    expect(past.map((s) => s.id).sort()).toEqual(
      firstPlan.slots
        .filter((s) => s.day < '2026-09-30')
        .map((s) => s.id)
        .sort()
    );
  });

  it('refuses to regenerate a confirmed plan and reports action none', async () => {
    const householdId = await richHousehold();
    const { screen } = await generatePlan(opts(householdId, WED));
    await confirmPlan(shownPlan(screen).id, opts(householdId, WED));

    await expect(generatePlan(opts(householdId, WED))).rejects.toMatchObject({
      code: 'plan_confirmed',
    });
    expect((await getPlanScreen(opts(householdId, WED))).view.action).toBe('none');
  });

  it('confirm activates the plan and records usage once per recipe, at the meal day', async () => {
    const householdId = await richHousehold();
    const { screen } = await generatePlan(opts(householdId, WED));
    const plan = shownPlan(screen);

    const confirmed = await confirmPlan(plan.id, opts(householdId, WED));

    expect(confirmed.plan.status).toBe('active');
    for (const slot of plan.slots) {
      const recipe = (await getRecipeById(slot.recipe!.id))!;
      expect(recipe.prefs?.times_used).toBe(1);
      expect(recipe.prefs?.last_used_at?.toISOString()).toBe(`${slot.day}T12:00:00.000Z`);
    }

    const again = await confirmPlan(plan.id, opts(householdId, WED));
    expect(again.plan.status).toBe('active');
    for (const slot of plan.slots) {
      expect((await getRecipeById(slot.recipe!.id))!.prefs?.times_used).toBe(1);
    }
  });

  it('two overlapping confirms count the usage exactly once', async () => {
    const householdId = await richHousehold();
    const { screen } = await generatePlan(opts(householdId, WED));
    const plan = shownPlan(screen);

    const results = await Promise.all([
      confirmPlan(plan.id, opts(householdId, WED)),
      confirmPlan(plan.id, opts(householdId, WED)),
    ]);

    expect(results.map((r) => r.plan.status)).toEqual(['active', 'active']);
    for (const slot of plan.slots) {
      expect((await getRecipeById(slot.recipe!.id))!.prefs?.times_used).toBe(1);
    }
  });

  it('confirm rejects plans of another household and unknown plans', async () => {
    const householdId = await richHousehold();
    const otherHouseholdId = await richHousehold();
    const { screen } = await generatePlan(opts(householdId, WED));
    const plan = shownPlan(screen);

    await expect(confirmPlan(plan.id, opts(otherHouseholdId, WED))).rejects.toMatchObject({
      code: 'plan_not_found',
    });
    await expect(
      confirmPlan(crypto.randomUUID(), opts(householdId, WED))
    ).rejects.toMatchObject({ code: 'plan_not_found' });
  });

  it('locks a slot, and rejects foreign plans, foreign slots and archived plans', async () => {
    const householdId = await richHousehold();
    const otherHouseholdId = await newHousehold();
    const weekPlan = shownPlan((await generatePlan(opts(householdId, WED))).screen);
    const nextPlan = shownPlan((await generatePlan(opts(householdId, SAT))).screen);
    const slot = weekPlan.slots[0];

    const locked = await setSlotLock(weekPlan.id, slot.id, true, opts(householdId, WED));
    expect(locked.plan.slots.find((s) => s.id === slot.id)!.locked).toBe(true);
    const unlocked = await setSlotLock(weekPlan.id, slot.id, false, opts(householdId, WED));
    expect(unlocked.plan.slots.find((s) => s.id === slot.id)!.locked).toBe(false);

    await expect(
      setSlotLock(weekPlan.id, slot.id, true, opts(otherHouseholdId, WED))
    ).rejects.toMatchObject({ code: 'plan_not_found' });
    await expect(
      setSlotLock(weekPlan.id, nextPlan.slots[0].id, true, opts(householdId, WED))
    ).rejects.toMatchObject({ code: 'slot_not_found' });

    const archived = await insertPlan(db, householdId, '2026-09-14');
    await archivePlansBefore(db, householdId, '2026-09-28');
    await expect(
      setSlotLock(archived.id, crypto.randomUUID(), true, opts(householdId, WED))
    ).rejects.toMatchObject({ code: 'plan_archived' });
  });

  it('keeps last week plan editable on weekends and closes it from the next Monday', async () => {
    const householdId = await richHousehold();
    const weekPlan = shownPlan((await generatePlan(opts(householdId, WED))).screen);
    await generatePlan(opts(householdId, SAT));
    const slotId = weekPlan.slots[0].id;

    const onSaturday = await setSlotLock(weekPlan.id, slotId, true, opts(householdId, SAT));
    expect(onSaturday.plan.slots.find((s) => s.id === slotId)!.locked).toBe(true);

    await expect(
      setSlotLock(weekPlan.id, slotId, false, opts(householdId, MON2))
    ).rejects.toMatchObject({ code: 'plan_archived' });
    await expect(confirmPlan(weekPlan.id, opts(householdId, MON2))).rejects.toMatchObject({
      code: 'plan_archived',
    });
    expect((await findPlanByWeek(db, householdId, '2026-09-28'))!.status).toBe('draft');
  });

  it('screen: no plans on a weekday shows the target week with action generate', async () => {
    const householdId = await newHousehold();

    const screen = await getPlanScreen(opts(householdId, WED));

    expect(screen.today).toBe('2026-09-30');
    expect(screen.current_week_start).toBe('2026-09-28');
    expect(screen.target).toEqual({
      week_start: '2026-09-28',
      first_day: '2026-09-30',
      last_day: '2026-10-04',
    });
    expect(screen.view).toEqual({
      week: screen.target,
      plan: null,
      action: 'generate',
      editable: false,
      can_repeat: false,
    });
    expect(screen.prev_week_start).toBeNull();
    expect(screen.next_week_start).toBeNull();
  });

  it('screen: on weekends without plans the initial view is the target week', async () => {
    const householdId = await newHousehold();

    const screen = await getPlanScreen(opts(householdId, SAT));

    expect(screen.view.week.week_start).toBe('2026-10-05');
    expect(screen.view.action).toBe('generate');
    expect(screen.prev_week_start).toBe('2026-09-28');
    expect(screen.next_week_start).toBeNull();
  });

  it('screen: on weekends the current week plan is the initial view, read-write, without generate', async () => {
    const householdId = await richHousehold();
    await generatePlan(opts(householdId, WED));

    const screen = await getPlanScreen(opts(householdId, SAT));

    expect(screen.view.week.week_start).toBe('2026-09-28');
    expect(screen.view.week.first_day).toBe('2026-09-28');
    expect(screen.view.week.last_day).toBe('2026-10-04');
    expect(screen.view.action).toBe('none');
    expect(screen.view.editable).toBe(true);
    expect(screen.next_week_start).toBe('2026-10-05');
    expect(screen.prev_week_start).toBeNull();
    expect(screen.target.week_start).toBe('2026-10-05');
  });

  it('screen: after generating on a weekend the target week plan is shown', async () => {
    const householdId = await richHousehold();
    await generatePlan(opts(householdId, WED));

    const { screen } = await generatePlan(opts(householdId, SAT));

    expect(screen.view.week.week_start).toBe('2026-10-05');
    expect(screen.view.week).toEqual(screen.target);
    expect(screen.view.action).toBe('regenerate');
    expect(screen.prev_week_start).toBe('2026-09-28');
  });

  it('screen: navigation skips past weeks without a plan and marks past weeks read-only', async () => {
    const householdId = await newHousehold();
    await insertPlan(db, householdId, '2026-09-14');
    await insertPlan(db, householdId, '2026-09-28');

    const current = await getPlanScreen({ ...opts(householdId, WED), week: '2026-09-28' });
    expect(current.prev_week_start).toBe('2026-09-14');
    expect(current.next_week_start).toBeNull();

    const past = await getPlanScreen({ ...opts(householdId, WED), week: '2026-09-14' });
    expect(past.view.week).toEqual({
      week_start: '2026-09-14',
      first_day: '2026-09-14',
      last_day: '2026-09-20',
    });
    expect(past.view.action).toBe('none');
    expect(past.view.editable).toBe(false);
    expect(past.prev_week_start).toBeNull();
    expect(past.next_week_start).toBe('2026-09-28');
  });

  it('screen: normalizes the requested week (non-Monday, beyond target, invalid)', async () => {
    const householdId = await newHousehold();

    const beyond = await getPlanScreen({ ...opts(householdId, SAT), week: '2026-10-12' });
    expect(beyond.view.week.week_start).toBe('2026-10-05');

    const midWeek = await getPlanScreen({ ...opts(householdId, SAT), week: '2026-09-30' });
    expect(midWeek.view.week.week_start).toBe('2026-09-28');

    for (const invalid of ['abc', '2026-02-31', '30/09/2026', '']) {
      const screen = await getPlanScreen({ ...opts(householdId, SAT), week: invalid });
      expect(screen.view.week.week_start).toBe('2026-10-05');
    }
  });

  it('screen: can_repeat only for a non-target week with recipes while the target is not confirmed', async () => {
    const householdId = await richHousehold();
    await generatePlan(opts(householdId, WED));

    // Sabato: la settimana corrente (28/09) è ripetibile sull'obiettivo (05/10) senza piano.
    const noTarget = await getPlanScreen({ ...opts(householdId, SAT), week: '2026-09-28' });
    expect(noTarget.view.can_repeat).toBe(true);
    expect(noTarget.target_plan_status).toBeNull();
    expect(noTarget.current_plan_id).toBe(shownPlan(noTarget).id);
    // Dalla settimana obiettivo vuota il piano corrente resta la sorgente di "Ripeti questa settimana".
    const targetEmpty = await getPlanScreen({ ...opts(householdId, SAT), week: '2026-10-05' });
    expect(targetEmpty.view.plan).toBeNull();
    expect(targetEmpty.current_plan_id).toBe(shownPlan(noTarget).id);

    // L'obiettivo non ripete se stesso; con l'obiettivo in bozza resta ripetibile.
    const generated = await generatePlan(opts(householdId, SAT));
    expect(generated.screen.view.can_repeat).toBe(false);
    const draftTarget = await getPlanScreen({ ...opts(householdId, SAT), week: '2026-09-28' });
    expect(draftTarget.view.can_repeat).toBe(true);
    expect(draftTarget.target_plan_status).toBe('draft');

    // Con l'obiettivo confermato non si può più ripetere.
    await confirmPlan(shownPlan(generated.screen).id, opts(householdId, SAT));
    const confirmedTarget = await getPlanScreen({ ...opts(householdId, SAT), week: '2026-09-28' });
    expect(confirmedTarget.view.can_repeat).toBe(false);
    expect(confirmedTarget.target_plan_status).toBe('active');
    expect(confirmedTarget.current_plan_id).toBeNull();

    // Un piano senza ricette non è ripetibile.
    const empty = await insertPlan(db, householdId, '2026-09-21');
    await insertSlots(db, empty.id, [
      { day: '2026-09-21', meal: 'cena', recipe_id: null, servings: 2, locked: false },
    ]);
    const emptyScreen = await getPlanScreen({ ...opts(householdId, WED), week: '2026-09-21' });
    expect(emptyScreen.view.can_repeat).toBe(false);
  });

  it('screen: a past week with recipes is repeatable onto a target week without plan', async () => {
    const householdId = await richHousehold();
    const past = await insertPlan(db, householdId, '2026-09-21');
    const [recipe] = await insertTestRecipes(householdId, 1, { meal_types: ['cena'] });
    await insertSlots(db, past.id, [
      { day: '2026-09-21', meal: 'cena', recipe_id: recipe.id, servings: 2, locked: false },
    ]);

    const screen = await getPlanScreen({ ...opts(householdId, WED), week: '2026-09-21' });

    expect(screen.view.can_repeat).toBe(true);
    expect(screen.view.editable).toBe(false);
  });

  it('flags a plan as superseded after a settings change and clears it on regeneration', async () => {
    const householdId = await richHousehold();
    const first = await generatePlan(opts(householdId, WED));
    expect(shownPlan(first.screen).superseded).toBe(false);

    await updateHousehold({ persons: 3 }, householdId);
    expect(shownPlan(await getPlanScreen(opts(householdId, WED))).superseded).toBe(true);

    const regenerated = await generatePlan(opts(householdId, WED));
    expect(shownPlan(regenerated.screen).superseded).toBe(false);
  });

  it('writes no hole when a slot is unlocked while the LLM is generating (selection re-run inside the lock)', async () => {
    const householdId = await newHousehold(['cena']);
    await insertTestRecipes(householdId, 10, { meal_types: ['cena'] });
    const first = shownPlan((await generatePlan(opts(householdId, MON))).screen);
    expect(first.slots).toHaveLength(7);
    const lockedSlot = first.slots[3];
    await setSlotLock(first.id, lockedSlot.id, true, opts(householdId, MON));

    const inner = fakeGenerate();
    let unlocked = false;
    const generate = vi.fn<GenerateRecipesFn>(async (input) => {
      if (!unlocked) {
        unlocked = true;
        await setSlotLock(first.id, lockedSlot.id, false, opts(householdId, MON));
      }
      return inner(input);
    });

    const { screen, generation } = await generatePlan(opts(householdId, MON, generate, { config: FORCE_GENERATION_CONFIG }));

    expect(generate).toHaveBeenCalled();
    expect(generation.failed).toBe(false);
    const plan = shownPlan(screen);
    expect(plan.slots).toHaveLength(7);
    expect(plan.slots.every((s) => s.recipe !== null)).toBe(true);
    expect(new Set(recipeIds(plan)).size).toBe(7);
  });

  it('never repeats a recipe when a slot is locked while the LLM is generating', async () => {
    const householdId = await newHousehold(['cena']);
    await insertTestRecipes(householdId, 10, { meal_types: ['cena'] });
    const first = shownPlan((await generatePlan(opts(householdId, MON))).screen);
    const slotToLock = first.slots[2];

    const inner = fakeGenerate();
    let locked = false;
    const generate = vi.fn<GenerateRecipesFn>(async (input) => {
      if (!locked) {
        locked = true;
        await setSlotLock(first.id, slotToLock.id, true, opts(householdId, MON));
      }
      return inner(input);
    });

    const { screen } = await generatePlan(opts(householdId, MON, generate, { config: FORCE_GENERATION_CONFIG }));

    const plan = shownPlan(screen);
    expect(plan.slots).toHaveLength(7);
    expect(new Set(recipeIds(plan)).size).toBe(7);
    const keptSlot = plan.slots.find((s) => s.id === slotToLock.id)!;
    expect(keptSlot.locked).toBe(true);
    expect(keptSlot.recipe!.id).toBe(slotToLock.recipe!.id);
  });
});
