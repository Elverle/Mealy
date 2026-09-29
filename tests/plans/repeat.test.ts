// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, recipe_prefs } from '@/lib/db';
import { findPlanByWeek, insertPlan, insertSlots } from '@/lib/db/repositories/plan-repo';
import { updateHousehold } from '@/lib/db/repositories/household-repo';
import { createRng } from '@/lib/domain/rng';
import { addDays, isoWeekday, listDays } from '@/lib/domain/week';
import type { MealType, PlanView } from '@/lib/domain/types';
import {
  confirmPlan,
  generatePlan,
  repeatPlan,
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

const MON = () => new Date('2026-09-28T08:00:00Z');
const WED = () => new Date('2026-09-30T10:00:00Z'); // settimana 28/09, dal 30/09
const SAT = () => new Date('2026-10-03T09:00:00Z'); // obiettivo: settimana 05/10

const BOTH_MEALS: MealType[] = ['pranzo', 'cena'];
const SOURCE_WEEK = '2026-09-28';
const TARGET_WEEK = '2026-10-05';

const DB_TEST_TIMEOUT_MS = 30_000; // setup multi-household sotto carico parallelo

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('repeatPlan', { timeout: DB_TEST_TIMEOUT_MS }, () => {
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

  /** Household con `perMeal` ricette solo pranzo e `perMeal` solo cena. */
  async function richHousehold(perMeal = 12): Promise<string> {
    const id = await createTestHousehold({ meals: BOTH_MEALS });
    createdHouseholdIds.push(id);
    await insertTestRecipes(id, perMeal, { meal_types: ['pranzo'] });
    await insertTestRecipes(id, perMeal, { meal_types: ['cena'] });
    return id;
  }

  function neverGenerate() {
    return vi
      .fn<GenerateRecipesFn>()
      .mockRejectedValue(new Error('generate non doveva essere chiamato'));
  }

  function emptyGenerate() {
    return vi.fn<GenerateRecipesFn>(async (input: GenerateAndStoreInput) => ({
      requested: input.count,
      created: [],
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

  async function sourcePlan(householdId: string): Promise<PlanView> {
    const { screen } = await generatePlan(opts(householdId, MON, emptyGenerate()));
    const plan = screen.view.plan;
    if (!plan || plan.slots.length !== 14) throw new Error('piano sorgente non valido');
    return plan;
  }

  function shownPlan(screen: { view: { plan: PlanView | null } }): PlanView {
    if (!screen.view.plan) throw new Error('nessun piano mostrato');
    return screen.view.plan;
  }

  /** Ricetta di ogni slot, indicizzata per giorno della settimana + pasto. */
  function byWeekdayAndMeal(plan: PlanView): Map<string, string | null> {
    return new Map(
      plan.slots.map((s) => [`${isoWeekday(s.day)}|${s.meal}`, s.recipe?.id ?? null] as const)
    );
  }

  it('copies the same recipe per weekday and meal onto the target week without calling the LLM', async () => {
    const householdId = await richHousehold();
    const source = await sourcePlan(householdId);
    const generate = neverGenerate();

    const { screen, generation } = await repeatPlan(source.id, opts(householdId, SAT, generate));

    expect(generate).not.toHaveBeenCalled();
    expect(generation).toEqual({ rounds: 0, created: 0, failed: false });
    const target = shownPlan(screen);
    expect(target.week_start).toBe(TARGET_WEEK);
    expect(target.status).toBe('draft');
    expect(target.id).not.toBe(source.id);
    expect(target.slots).toHaveLength(14);
    expect(byWeekdayAndMeal(target)).toEqual(byWeekdayAndMeal(source));
  });

  it('fills only the slot whose source recipe was blocked afterwards, with a different recipe', async () => {
    const householdId = await richHousehold();
    const source = await sourcePlan(householdId);
    const blockedSlot = source.slots.find((s) => s.day === '2026-09-30' && s.meal === 'cena')!;
    await db
      .update(recipe_prefs)
      .set({ blocked: true })
      .where(eq(recipe_prefs.recipe_id, blockedSlot.recipe!.id));

    const { screen } = await repeatPlan(source.id, opts(householdId, SAT));

    const target = shownPlan(screen);
    const before = byWeekdayAndMeal(source);
    const after = byWeekdayAndMeal(target);
    const changed = [...before.keys()].filter((key) => before.get(key) !== after.get(key));
    expect(changed).toEqual([`${isoWeekday(blockedSlot.day)}|cena`]);
    const replacement = after.get(`${isoWeekday(blockedSlot.day)}|cena`);
    expect(replacement).not.toBeNull();
    expect(replacement).not.toBe(blockedSlot.recipe!.id);
    expect(new Set(target.slots.map((s) => s.recipe!.id)).size).toBe(14);
  });

  it('generates only when a slot cannot be filled from the library', async () => {
    const householdId = await richHousehold(7);
    const source = await sourcePlan(householdId);
    const blockedSlot = source.slots.find((s) => s.meal === 'pranzo')!;
    await db
      .update(recipe_prefs)
      .set({ blocked: true })
      .where(eq(recipe_prefs.recipe_id, blockedSlot.recipe!.id));
    const generate = vi.fn<GenerateRecipesFn>(async (input: GenerateAndStoreInput) => ({
      requested: input.count,
      created: await insertTestRecipes(householdId, input.count, { meal_types: ['pranzo'] }),
      skipped: [],
    }));

    const { screen, generation } = await repeatPlan(source.id, opts(householdId, SAT, generate));

    // Un solo slot vuoto, nessuna candidata: deficit 3 + extra 2 = 5 ricette, in lotti da 3 + 2, solo pranzo.
    expect(generate.mock.calls.map(([input]) => [input.mealType, input.count])).toEqual([
      ['pranzo', 3],
      ['pranzo', 2],
    ]);
    expect(generation).toEqual({ rounds: 1, created: 5, failed: false });
    expect(shownPlan(screen).slots.every((s) => s.recipe !== null)).toBe(true);
  });

  it('throws insufficient_recipes and writes nothing when a slot cannot be filled', async () => {
    const householdId = await richHousehold(7);
    const source = await sourcePlan(householdId);
    const blockedSlot = source.slots.find((s) => s.meal === 'pranzo')!;
    await db
      .update(recipe_prefs)
      .set({ blocked: true })
      .where(eq(recipe_prefs.recipe_id, blockedSlot.recipe!.id));

    await expect(
      repeatPlan(source.id, opts(householdId, SAT, emptyGenerate()))
    ).rejects.toMatchObject({ code: 'insufficient_recipes' });

    expect(await findPlanByWeek(db, householdId, TARGET_WEEK)).toBeNull();
  });

  it('drops the meals no longer in the household settings', async () => {
    const householdId = await richHousehold();
    const source = await sourcePlan(householdId);
    await updateHousehold({ meals: ['cena'] }, householdId);

    const { screen } = await repeatPlan(source.id, opts(householdId, SAT));

    const target = shownPlan(screen);
    expect(target.slots).toHaveLength(7);
    expect(target.slots.every((s) => s.meal === 'cena')).toBe(true);
    const sourceDinners = byWeekdayAndMeal(source);
    for (const slot of target.slots) {
      expect(slot.recipe!.id).toBe(sourceDinners.get(`${isoWeekday(slot.day)}|cena`));
    }
  });

  it('refuses to repeat the target week onto itself', async () => {
    const householdId = await richHousehold();
    await sourcePlan(householdId);
    const target = shownPlan((await generatePlan(opts(householdId, SAT))).screen);

    await expect(repeatPlan(target.id, opts(householdId, SAT))).rejects.toMatchObject({
      name: 'PlanError',
      code: 'repeat_same_week',
    });
  });

  it('refuses to overwrite a confirmed target plan', async () => {
    const householdId = await richHousehold();
    const source = await sourcePlan(householdId);
    const target = shownPlan((await generatePlan(opts(householdId, SAT))).screen);
    await confirmPlan(target.id, opts(householdId, SAT));

    await expect(repeatPlan(source.id, opts(householdId, SAT))).rejects.toMatchObject({
      code: 'plan_confirmed',
    });
  });

  it('rejects unknown plans and plans of another household', async () => {
    const householdId = await richHousehold();
    const otherHouseholdId = await richHousehold();
    const source = await sourcePlan(householdId);

    await expect(
      repeatPlan(source.id, opts(otherHouseholdId, SAT))
    ).rejects.toMatchObject({ code: 'plan_not_found' });
    await expect(
      repeatPlan(crypto.randomUUID(), opts(householdId, SAT))
    ).rejects.toMatchObject({ code: 'plan_not_found' });
    expect(await findPlanByWeek(db, otherHouseholdId, TARGET_WEEK)).toBeNull();
  });

  it('keeps a locked slot of an existing target draft intact and replaces the rest', async () => {
    const householdId = await richHousehold();
    const source = await sourcePlan(householdId);
    const draft = shownPlan((await generatePlan(opts(householdId, SAT))).screen);
    const locked = draft.slots.find((s) => s.day === '2026-10-07' && s.meal === 'cena')!;
    await setSlotLock(draft.id, locked.id, true, opts(householdId, SAT));

    const { screen } = await repeatPlan(source.id, opts(householdId, SAT));

    const target = shownPlan(screen);
    expect(target.id).toBe(draft.id);
    expect(target.slots).toHaveLength(14);
    const keptSlot = target.slots.find((s) => s.id === locked.id)!;
    expect(keptSlot.locked).toBe(true);
    expect(keptSlot.recipe!.id).toBe(locked.recipe!.id);
    // Le altre ricette copiano la sorgente, salvo quella già usata dallo slot bloccato.
    const sourceRecipes = byWeekdayAndMeal(source);
    for (const slot of target.slots.filter((s) => s.id !== locked.id)) {
      const wanted = sourceRecipes.get(`${isoWeekday(slot.day)}|${slot.meal}`);
      if (wanted !== locked.recipe!.id) expect(slot.recipe!.id).toBe(wanted);
    }
    expect(new Set(target.slots.map((s) => s.recipe!.id)).size).toBe(14);
  });

  it('repeats a past week onto the current week, refilling only the days from today on', async () => {
    const householdId = await richHousehold(12);
    // Bozza della settimana corrente creata a inizio settimana: i giorni passati restano.
    const current = await sourcePlan(householdId);
    const pastWeek = '2026-09-21';
    const past = await insertPlan(db, householdId, pastWeek);
    const pastRecipes = {
      pranzo: await insertTestRecipes(householdId, 7, { meal_types: ['pranzo'] }),
      cena: await insertTestRecipes(householdId, 7, { meal_types: ['cena'] }),
    };
    await insertSlots(
      db,
      past.id,
      listDays(pastWeek, addDays(pastWeek, 6)).flatMap((day, index) =>
        BOTH_MEALS.map((meal) => ({
          day,
          meal,
          recipe_id: pastRecipes[meal][index].id,
          servings: 2,
          locked: false,
        }))
      )
    );

    const { screen } = await repeatPlan(past.id, opts(householdId, WED));

    const target = shownPlan(screen);
    expect(target.id).toBe(current.id);
    expect(target.slots).toHaveLength(14);
    for (const before of current.slots.filter((s) => s.day < '2026-09-30')) {
      const after = target.slots.find((s) => s.id === before.id)!;
      expect(after.recipe!.id).toBe(before.recipe!.id);
    }
    const future = target.slots.filter((s) => s.day >= '2026-09-30');
    expect(future).toHaveLength(10);
    for (const slot of future) {
      const index = isoWeekday(slot.day) - 1;
      expect(slot.recipe!.id).toBe(pastRecipes[slot.meal][index].id);
      expect(current.slots.some((s) => s.id === slot.id)).toBe(false);
    }
  });
});
