// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, meal_plans, shopping_lists } from '@/lib/db';
import {
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
} from '@/lib/db/repositories/plan-repo';
import {
  deleteRecipe,
  getRecipeById,
  insertRecipeWith,
  listRecipes,
  listRecipesWith,
} from '@/lib/db/repositories/recipe-repo';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { insertTestRecipe, insertTestRecipes } from '@/tests/helpers/plans';

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('plan-repo', () => {
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

  async function newHousehold(): Promise<string> {
    const id = await createTestHousehold();
    createdHouseholdIds.push(id);
    return id;
  }

  it('insertPlan creates a draft with generated_at and findPlanByWeek finds it empty', async () => {
    const householdId = await newHousehold();

    const plan = await insertPlan(db, householdId, '2026-09-28');
    expect(plan.status).toBe('draft');
    expect(plan.week_start).toBe('2026-09-28');
    expect(plan.generated_at).toBeInstanceOf(Date);

    const found = await findPlanByWeek(db, householdId, '2026-09-28');
    expect(found).not.toBeNull();
    expect(found?.id).toBe(plan.id);
    expect(found?.slots).toEqual([]);
    expect(found?.shopping_list).toEqual({ exists: false, needs_regeneration: false });
    expect(await findPlanByWeek(db, householdId, '2026-10-05')).toBeNull();
    expect((await getPlanById(db, plan.id))?.id).toBe(plan.id);
    expect(await getPlanById(db, crypto.randomUUID())).toBeNull();
  });

  it('insertSlots returns slots ordered by day then meal with full recipes', async () => {
    const householdId = await newHousehold();
    const [recipe] = await insertTestRecipes(householdId, 1, {
      meal_types: ['pranzo', 'cena'],
      prefs: { favorite: true },
    });
    const plan = await insertPlan(db, householdId, '2026-09-28');

    await insertSlots(db, plan.id, [
      { day: '2026-10-01', meal: 'cena', recipe_id: recipe.id, servings: 2, locked: false },
      { day: '2026-10-01', meal: 'pranzo', recipe_id: null, servings: 2, locked: true },
      { day: '2026-09-30', meal: 'cena', recipe_id: recipe.id, servings: 3, locked: false },
    ]);

    const found = await findPlanByWeek(db, householdId, '2026-09-28');
    expect(found?.slots.map((s) => `${s.day} ${s.meal}`)).toEqual([
      '2026-09-30 cena',
      '2026-10-01 pranzo',
      '2026-10-01 cena',
    ]);
    const [first, second, third] = found!.slots;
    expect(first.recipe?.id).toBe(recipe.id);
    expect(first.recipe?.ingredients).toHaveLength(1);
    expect(first.recipe?.prefs?.favorite).toBe(true);
    expect(first.servings).toBe(3);
    expect(second.recipe).toBeNull();
    expect(second.recipe_id).toBeNull();
    expect(second.locked).toBe(true);
    expect(third.recipe?.title).toBe(recipe.title);
  });

  it('touchPlanGeneratedAt moves generated_at forward', async () => {
    const householdId = await newHousehold();
    const plan = await insertPlan(db, householdId, '2026-09-28');
    await new Promise((resolve) => setTimeout(resolve, 20));

    await touchPlanGeneratedAt(db, plan.id);

    const found = await getPlanById(db, plan.id);
    expect(found!.generated_at.getTime()).toBeGreaterThan(plan.generated_at.getTime());
  });

  it('archivePlansBefore archives earlier non-archived plans and leaves later ones', async () => {
    const householdId = await newHousehold();
    const p1 = await insertPlan(db, householdId, '2026-09-21');
    const p2 = await insertPlan(db, householdId, '2026-09-28');
    const p3 = await insertPlan(db, householdId, '2026-10-05');
    await activateDraftPlan(db, p2.id);

    const archived = await archivePlansBefore(db, householdId, '2026-10-05');

    expect(archived).toBe(2);
    expect((await getPlanById(db, p1.id))?.status).toBe('archived');
    expect((await getPlanById(db, p2.id))?.status).toBe('archived');
    expect((await getPlanById(db, p3.id))?.status).toBe('draft');
    expect(await archivePlansBefore(db, householdId, '2026-10-05')).toBe(0);
  });

  it('incrementRecipeUsage counts once per recipe and uses the most recent meal day', async () => {
    const householdId = await newHousehold();
    const [a, b] = await insertTestRecipes(householdId, 2, { meal_types: ['pranzo'] });
    expect(a.prefs?.times_used).toBe(0);

    await incrementRecipeUsage(db, [
      { recipeId: a.id, day: '2026-10-01' },
      { recipeId: a.id, day: '2026-10-03' },
      { recipeId: b.id, day: '2026-10-01' },
    ]);

    const afterFirst = { a: await getRecipeById(a.id), b: await getRecipeById(b.id) };
    expect(afterFirst.a?.prefs?.times_used).toBe(1);
    expect(afterFirst.a?.prefs?.last_used_at?.toISOString()).toBe('2026-10-03T12:00:00.000Z');
    expect(afterFirst.b?.prefs?.times_used).toBe(1);
    expect(afterFirst.b?.prefs?.last_used_at?.toISOString()).toBe('2026-10-01T12:00:00.000Z');

    await incrementRecipeUsage(db, [{ recipeId: a.id, day: '2026-09-20' }]);

    const afterSecond = await getRecipeById(a.id);
    expect(afterSecond?.prefs?.times_used).toBe(2);
    expect(afterSecond?.prefs?.last_used_at?.toISOString()).toBe('2026-10-03T12:00:00.000Z');
  });

  it('incrementRecipeUsage moves last_used_at forward and handles a missing prefs row', async () => {
    const householdId = await newHousehold();
    const recipe = await insertTestRecipe(householdId, { meal_types: ['cena'] });
    await db.execute(sql`delete from recipe_prefs where recipe_id = ${recipe.id}`);

    await incrementRecipeUsage(db, [{ recipeId: recipe.id, day: '2026-10-01' }]);
    await incrementRecipeUsage(db, [{ recipeId: recipe.id, day: '2026-10-08' }]);

    const after = await getRecipeById(recipe.id);
    expect(after?.prefs?.times_used).toBe(2);
    expect(after?.prefs?.last_used_at?.toISOString()).toBe('2026-10-08T12:00:00.000Z');
  });

  it('incrementRecipeUsage with an empty array is a no-op and rejects malformed days', async () => {
    await expect(incrementRecipeUsage(db, [])).resolves.toBeUndefined();
    await expect(
      incrementRecipeUsage(db, [{ recipeId: crypto.randomUUID(), day: 'domani' }])
    ).rejects.toThrow(/Giorno non valido/);
  });

  it('markShoppingListStale returns false without a list and true (persisted) with one', async () => {
    const householdId = await newHousehold();
    const plan = await insertPlan(db, householdId, '2026-09-28');

    expect(await markShoppingListStale(db, plan.id)).toBe(false);

    await db.insert(shopping_lists).values({ plan_id: plan.id });
    expect((await findPlanByWeek(db, householdId, '2026-09-28'))?.shopping_list).toEqual({
      exists: true,
      needs_regeneration: false,
    });
    expect(await markShoppingListStale(db, plan.id)).toBe(true);
    expect((await findPlanByWeek(db, householdId, '2026-09-28'))?.shopping_list).toEqual({
      exists: true,
      needs_regeneration: true,
    });
  });

  it('setSlotLocked returns false for an unknown slot and toggles an existing one', async () => {
    const householdId = await newHousehold();
    const plan = await insertPlan(db, householdId, '2026-09-28');
    await insertSlots(db, plan.id, [
      { day: '2026-09-28', meal: 'pranzo', recipe_id: null, servings: 2, locked: false },
    ]);
    const slotId = (await getPlanById(db, plan.id))!.slots[0].id;

    expect(await setSlotLocked(db, crypto.randomUUID(), true)).toBe(false);
    expect(await setSlotLocked(db, slotId, true)).toBe(true);
    expect((await getPlanById(db, plan.id))!.slots[0].locked).toBe(true);
  });

  it('activateDraftPlan activates a draft once and returns false afterwards', async () => {
    const householdId = await newHousehold();
    const plan = await insertPlan(db, householdId, '2026-09-28');

    expect(await activateDraftPlan(db, plan.id)).toBe(true);
    expect((await getPlanById(db, plan.id))?.status).toBe('active');
    expect(await activateDraftPlan(db, plan.id)).toBe(false);
    expect((await getPlanById(db, plan.id))?.status).toBe('active');
  });

  it('activateDraftPlan does not touch archived plans or unknown ids', async () => {
    const householdId = await newHousehold();
    const plan = await insertPlan(db, householdId, '2026-09-21');
    await archivePlansBefore(db, householdId, '2026-09-28');

    expect(await activateDraftPlan(db, plan.id)).toBe(false);
    expect((await getPlanById(db, plan.id))?.status).toBe('archived');
    expect(await activateDraftPlan(db, crypto.randomUUID())).toBe(false);
  });

  it('listPlanWeeks returns the household weeks in ascending order', async () => {
    const householdId = await newHousehold();
    const otherHouseholdId = await newHousehold();
    await insertPlan(db, householdId, '2026-10-05');
    await insertPlan(db, householdId, '2026-09-21');
    await insertPlan(db, householdId, '2026-09-28');
    await insertPlan(db, otherHouseholdId, '2026-08-03');

    expect(await listPlanWeeks(db, householdId)).toEqual(['2026-09-21', '2026-09-28', '2026-10-05']);
    expect(await listPlanWeeks(db, crypto.randomUUID())).toEqual([]);
  });

  it('deleteSlots, updateSlotsServings and updateSlotRecipe edit slots; empty arrays are no-ops', async () => {
    const householdId = await newHousehold();
    const [r1, r2] = await insertTestRecipes(householdId, 2, { meal_types: ['pranzo', 'cena'] });
    const plan = await insertPlan(db, householdId, '2026-09-28');
    await insertSlots(db, plan.id, []);
    await insertSlots(db, plan.id, [
      { day: '2026-09-28', meal: 'pranzo', recipe_id: r1.id, servings: 2, locked: false },
      { day: '2026-09-28', meal: 'cena', recipe_id: r1.id, servings: 2, locked: false },
      { day: '2026-09-29', meal: 'pranzo', recipe_id: r1.id, servings: 2, locked: false },
    ]);
    const [s1, s2, s3] = (await getPlanById(db, plan.id))!.slots;

    await deleteSlots(db, []);
    await updateSlotsServings(db, [], 9);
    expect((await getPlanById(db, plan.id))!.slots).toHaveLength(3);

    await updateSlotsServings(db, [s1.id, s2.id], 4);
    await updateSlotRecipe(db, s3.id, r2.id);
    await deleteSlots(db, [s2.id]);

    const slots = (await getPlanById(db, plan.id))!.slots;
    expect(slots.map((s) => s.id)).toEqual([s1.id, s3.id]);
    expect(slots[0].servings).toBe(4);
    expect(slots[1].servings).toBe(2);
    expect(slots[1].recipe?.id).toBe(r2.id);
  });

  it('a slot survives deletion of its recipe (recipe_id becomes null)', async () => {
    const householdId = await newHousehold();
    const recipe = await insertTestRecipe(householdId, { meal_types: ['pranzo'] });
    const plan = await insertPlan(db, householdId, '2026-09-28');
    await insertSlots(db, plan.id, [
      { day: '2026-09-28', meal: 'pranzo', recipe_id: recipe.id, servings: 2, locked: false },
    ]);
    await deleteRecipe(recipe.id);

    const slot = (await getPlanById(db, plan.id))!.slots[0];
    expect(slot.recipe_id).toBeNull();
    expect(slot.recipe).toBeNull();
  });

  it('cascade: deleting the plan row removes its slots', async () => {
    const householdId = await newHousehold();
    const plan = await insertPlan(db, householdId, '2026-09-28');
    await insertSlots(db, plan.id, [
      { day: '2026-09-28', meal: 'pranzo', recipe_id: null, servings: 2, locked: false },
    ]);
    await db.delete(meal_plans).where(eq(meal_plans.id, plan.id));
    expect(await getPlanById(db, plan.id)).toBeNull();
  });
});

describe.skipIf(!dbUp)('listRecipesWith', () => {
  const householdIds: string[] = [];

  beforeAll(async () => {
    await assertDbMigrated();
  });

  afterEach(async () => {
    for (const id of householdIds.splice(0)) {
      await deleteTestHousehold(id);
    }
  });

  it('reads through a transaction and matches listRecipes', async () => {
    const householdId = await createTestHousehold();
    householdIds.push(householdId);
    const inserted = await insertTestRecipes(householdId, 2, { meal_types: ['cena'] });

    const viaTx = await db.transaction((tx) => listRecipesWith(tx, { household_id: householdId }));
    const viaGlobal = await listRecipes({ household_id: householdId });

    expect(viaTx.map((r) => r.id).sort()).toEqual(inserted.map((r) => r.id).sort());
    expect(viaTx).toEqual(viaGlobal);
    expect(viaTx[0].ingredients).toHaveLength(1);
    expect(viaTx[0].prefs).not.toBeNull();
  });

  it('sees uncommitted recipes inserted in the same transaction', async () => {
    const householdId = await createTestHousehold();
    householdIds.push(householdId);

    const seen = await db.transaction(async (tx) => {
      await insertRecipeWith(tx, {
        household_id: householdId,
        title: 'Solo in transazione',
        slug: `solo-in-transazione-${crypto.randomUUID().slice(0, 8)}`,
        steps: ['Passo.'],
        meal_types: ['pranzo'],
        servings_base: 2,
        prep_minutes: 10,
      });
      return listRecipesWith(tx, { household_id: householdId });
    });

    expect(seen.map((r) => r.title)).toEqual(['Solo in transazione']);
  });
});
