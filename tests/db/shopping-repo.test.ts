// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, ingredient_aliases, meal_plans, shopping_items, shopping_lists } from '@/lib/db';
import {
  activateDraftPlan,
  insertPlan,
  markShoppingListStale,
} from '@/lib/db/repositories/plan-repo';
import {
  deleteShoppingItems,
  findManualShoppingItem,
  findShoppingListByPlan,
  getShoppingItemContext,
  insertShoppingItems,
  insertShoppingList,
  listIngredientAliases,
  listOpenPlans,
  listRecipeRefs,
  listShoppingItems,
  markShoppingListGenerated,
  setShoppingItemChecked,
  updateGeneratedShoppingItem,
  type NewShoppingItemInput,
} from '@/lib/db/repositories/shopping-repo';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { insertTestRecipe } from '@/tests/helpers/plans';

const dbUp = await isDbAvailable();

const WEEK = '2026-09-28';

function genericItem(overrides: Partial<NewShoppingItemInput> = {}): NewShoppingItemInput {
  return {
    canonical_name: 'farina',
    qty: 250.5,
    unit: 'g',
    category: 'dispensa',
    checked: false,
    manual: false,
    recipe_ids: [],
    ...overrides,
  };
}

describe.skipIf(!dbUp)('shopping-repo', () => {
  let createdHouseholdIds: string[] = [];
  let createdAliases: string[] = [];

  beforeAll(async () => {
    await assertDbMigrated();
  });

  afterEach(async () => {
    for (const id of createdHouseholdIds) {
      await deleteTestHousehold(id);
    }
    createdHouseholdIds = [];
    for (const alias of createdAliases) {
      await db.delete(ingredient_aliases).where(eq(ingredient_aliases.alias, alias));
    }
    createdAliases = [];
  });

  async function newHousehold(): Promise<string> {
    const id = await createTestHousehold();
    createdHouseholdIds.push(id);
    return id;
  }

  async function newPlan(householdId: string, week = WEEK): Promise<string> {
    return (await insertPlan(db, householdId, week)).id;
  }

  it('findShoppingListByPlan is null until insertShoppingList creates a fresh list', async () => {
    const householdId = await newHousehold();
    const planId = await newPlan(householdId);

    expect(await findShoppingListByPlan(db, planId)).toBeNull();

    const created = await insertShoppingList(db, planId);
    expect(created.plan_id).toBe(planId);
    expect(created.needs_regeneration).toBe(false);
    expect(await findShoppingListByPlan(db, planId)).toEqual(created);
  });

  it('markShoppingListGenerated clears needs_regeneration and does not move generated_at back', async () => {
    const householdId = await newHousehold();
    const planId = await newPlan(householdId);
    const list = await insertShoppingList(db, planId);
    await markShoppingListStale(db, planId);

    const stale = await findShoppingListByPlan(db, planId);
    expect(stale?.needs_regeneration).toBe(true);

    const regenerated = await markShoppingListGenerated(db, list.id);
    expect(regenerated.needs_regeneration).toBe(false);
    expect(regenerated.generated_at.getTime()).toBeGreaterThanOrEqual(list.generated_at.getTime());
  });

  it('insertShoppingItems and listShoppingItems map qty to number and keep nulls and recipe ids', async () => {
    const householdId = await newHousehold();
    const recipe = await insertTestRecipe(householdId, { meal_types: ['pranzo'] });
    const planId = await newPlan(householdId);
    const list = await insertShoppingList(db, planId);

    expect(await insertShoppingItems(db, list.id, [])).toEqual([]);

    const inserted = await insertShoppingItems(db, list.id, [
      genericItem({ recipe_ids: [recipe.id] }),
      genericItem({ canonical_name: 'sale', qty: null, unit: null, category: 'dispensa', manual: true }),
    ]);
    expect(inserted).toHaveLength(2);

    const listed = await listShoppingItems(db, list.id);
    expect(listed.map((i) => i.id)).toEqual(inserted.map((i) => i.id).sort());

    const farina = listed.find((i) => i.canonical_name === 'farina');
    expect(farina?.qty).toBe(250.5);
    expect(farina?.unit).toBe('g');
    expect(farina?.recipe_ids).toEqual([recipe.id]);

    const sale = listed.find((i) => i.canonical_name === 'sale');
    expect(sale?.qty).toBeNull();
    expect(sale?.unit).toBeNull();
    expect(sale?.manual).toBe(true);
    expect(sale?.recipe_ids).toEqual([]);
  });

  it('updateGeneratedShoppingItem changes quantity, category, checked and recipes only', async () => {
    const householdId = await newHousehold();
    const recipe = await insertTestRecipe(householdId, { meal_types: ['cena'] });
    const planId = await newPlan(householdId);
    const list = await insertShoppingList(db, planId);
    const [item] = await insertShoppingItems(db, list.id, [genericItem()]);

    await updateGeneratedShoppingItem(db, item.id, {
      qty: 500,
      category: 'pane',
      checked: true,
      recipe_ids: [recipe.id],
    });

    const [updated] = await listShoppingItems(db, list.id);
    expect(updated.qty).toBe(500);
    expect(updated.category).toBe('pane');
    expect(updated.checked).toBe(true);
    expect(updated.recipe_ids).toEqual([recipe.id]);
    expect(updated.canonical_name).toBe('farina');
    expect(updated.unit).toBe('g');
    expect(updated.manual).toBe(false);
  });

  it('setShoppingItemChecked returns the updated row, or null for an unknown id', async () => {
    const householdId = await newHousehold();
    const planId = await newPlan(householdId);
    const list = await insertShoppingList(db, planId);
    const [item] = await insertShoppingItems(db, list.id, [genericItem()]);

    const checked = await setShoppingItemChecked(db, item.id, true);
    expect(checked?.id).toBe(item.id);
    expect(checked?.checked).toBe(true);
    expect((await listShoppingItems(db, list.id))[0].checked).toBe(true);

    expect(await setShoppingItemChecked(db, crypto.randomUUID(), true)).toBeNull();
  });

  it('deleteShoppingItems removes only the given ids and accepts an empty array', async () => {
    const householdId = await newHousehold();
    const planId = await newPlan(householdId);
    const list = await insertShoppingList(db, planId);
    const [a, b] = await insertShoppingItems(db, list.id, [
      genericItem({ canonical_name: 'uova', qty: 2, unit: 'pz' }),
      genericItem({ canonical_name: 'latte', qty: 500, unit: 'ml', category: 'banco-frigo' }),
    ]);

    await deleteShoppingItems(db, []);
    expect(await listShoppingItems(db, list.id)).toHaveLength(2);

    await deleteShoppingItems(db, [a.id]);
    const remaining = await listShoppingItems(db, list.id);
    expect(remaining.map((i) => i.id)).toEqual([b.id]);
  });

  it('findManualShoppingItem finds only manual items, and only in the given list', async () => {
    const householdId = await newHousehold();
    const firstPlan = await newPlan(householdId, '2026-09-28');
    const secondPlan = await newPlan(householdId, '2026-10-05');
    const firstList = await insertShoppingList(db, firstPlan);
    const secondList = await insertShoppingList(db, secondPlan);

    await insertShoppingItems(db, firstList.id, [
      genericItem({ canonical_name: 'sale', qty: null, unit: 'qb', category: 'dispensa' }),
    ]);
    const [manual] = await insertShoppingItems(db, firstList.id, [
      genericItem({ canonical_name: 'carta forno', qty: null, unit: null, manual: true }),
    ]);
    await insertShoppingItems(db, secondList.id, [
      genericItem({ canonical_name: 'olio', qty: null, unit: null, manual: true }),
    ]);

    expect((await findManualShoppingItem(db, firstList.id, 'carta forno'))?.id).toBe(manual.id);
    expect(await findManualShoppingItem(db, firstList.id, 'sale')).toBeNull();
    expect(await findManualShoppingItem(db, firstList.id, 'olio')).toBeNull();
  });

  it('getShoppingItemContext returns the item with its plan, or null for an unknown id', async () => {
    const householdId = await newHousehold();
    const planId = await newPlan(householdId);
    const list = await insertShoppingList(db, planId);
    const [item] = await insertShoppingItems(db, list.id, [genericItem()]);

    const context = await getShoppingItemContext(db, item.id);
    expect(context?.item.id).toBe(item.id);
    expect(context?.plan).toEqual({
      id: planId,
      household_id: householdId,
      week_start: WEEK,
      status: 'draft',
    });

    expect(await getShoppingItemContext(db, crypto.randomUUID())).toBeNull();
  });

  it('listRecipeRefs returns existing recipes by title, ignores unknown ids and handles empty input', async () => {
    const householdId = await newHousehold();
    const recipeB = await insertTestRecipe(householdId, { meal_types: ['pranzo'], title: 'B test' });
    const recipeA = await insertTestRecipe(householdId, { meal_types: ['pranzo'], title: 'A test' });

    const refs = await listRecipeRefs(db, [recipeB.id, crypto.randomUUID(), recipeA.id]);
    expect(refs).toEqual([
      { id: recipeA.id, title: 'A test' },
      { id: recipeB.id, title: 'B test' },
    ]);

    expect(await listRecipeRefs(db, [])).toEqual([]);
  });

  it('listOpenPlans returns open plans of the week onward, with list presence, excluding archived', async () => {
    const householdId = await newHousehold();
    const past = await insertPlan(db, householdId, '2026-09-21');
    await activateDraftPlan(db, past.id);
    const draft = await insertPlan(db, householdId, '2026-09-28');
    const active = await insertPlan(db, householdId, '2026-10-05');
    await activateDraftPlan(db, active.id);
    await insertShoppingList(db, active.id);
    const archivedLater = await insertPlan(db, householdId, '2026-10-12');
    await db
      .update(meal_plans)
      .set({ status: 'archived' })
      .where(eq(meal_plans.id, archivedLater.id));

    const open = await listOpenPlans(db, householdId, '2026-09-28');
    expect(open).toEqual([
      { id: draft.id, week_start: '2026-09-28', status: 'draft', has_list: false },
      { id: active.id, week_start: '2026-10-05', status: 'active', has_list: true },
    ]);
  });

  it('listIngredientAliases includes an alias inserted by the test', async () => {
    const alias = `alias-test-${crypto.randomUUID()}`;
    const canonical = `canonico-test-${crypto.randomUUID()}`;
    createdAliases.push(alias);
    await db.insert(ingredient_aliases).values({ alias, canonical_name: canonical });

    const aliases = await listIngredientAliases(db);
    expect(aliases).toContainEqual({ alias, canonical_name: canonical });
  });

  it('deleting the household cascades to its shopping list and items', async () => {
    const householdId = await newHousehold();
    const planId = await newPlan(householdId);
    const list = await insertShoppingList(db, planId);
    const items = await insertShoppingItems(db, list.id, [genericItem()]);

    await deleteTestHousehold(householdId);
    createdHouseholdIds = createdHouseholdIds.filter((id) => id !== householdId);

    expect(await db.select().from(shopping_lists).where(eq(shopping_lists.id, list.id))).toEqual(
      []
    );
    expect(
      await db
        .select()
        .from(shopping_items)
        .where(inArray(shopping_items.id, items.map((i) => i.id)))
    ).toEqual([]);
  });
});
