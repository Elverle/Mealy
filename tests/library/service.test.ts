// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { EMPTY_LIBRARY_FILTER, RecipeDetailViewSchema } from '@/lib/domain/types';
import { db } from '@/lib/db';
import { upsertIngredientPref } from '@/lib/db/repositories/ingredient-pref-repo';
import { getRecipeDetail, listLibrary, listLibraryCards } from '@/lib/library/service';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { insertTestRecipe } from '@/tests/helpers/plans';

const DB_TEST_TIMEOUT_MS = 60_000;

const ONION = {
  canonical_name: 'cipolla',
  display_name: 'Cipolla',
  qty: 1,
  unit: 'pz' as const,
  category: 'ortofrutta' as const,
};
const SALT_DUP = {
  canonical_name: 'sale',
  display_name: 'Sale fino',
  qty: null,
  unit: 'qb' as const,
  category: 'dispensa' as const,
};

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('library service', { timeout: DB_TEST_TIMEOUT_MS }, () => {
  let householdIds: string[] = [];

  beforeAll(async () => {
    await assertDbMigrated();
  });

  afterEach(async () => {
    for (const id of householdIds) await deleteTestHousehold(id);
    householdIds = [];
  });

  async function newHousehold(): Promise<string> {
    const id = await createTestHousehold();
    householdIds.push(id);
    return id;
  }

  it('listLibraryCards includes blocked recipes with favorites first', async () => {
    const hid = await newHousehold();
    const plain = await insertTestRecipe(hid, { meal_types: ['cena'] });
    const blocked = await insertTestRecipe(hid, { meal_types: ['cena'], prefs: { blocked: true } });
    const fav = await insertTestRecipe(hid, { meal_types: ['cena'], prefs: { favorite: true } });

    const cards = await listLibraryCards(hid);

    expect(cards).toHaveLength(3);
    expect(cards[0].id).toBe(fav.id);
    expect(cards.map((c) => c.id)).toEqual(expect.arrayContaining([plain.id, blocked.id]));
    expect(cards.find((c) => c.id === blocked.id)?.blocked).toBe(true);
  });

  it('listLibrary with blocked filter returns only blocked and total counts everything', async () => {
    const hid = await newHousehold();
    await insertTestRecipe(hid, { meal_types: ['cena'] });
    await insertTestRecipe(hid, { meal_types: ['cena'] });
    const blocked = await insertTestRecipe(hid, { meal_types: ['cena'], prefs: { blocked: true } });

    const view = await listLibrary({ ...EMPTY_LIBRARY_FILTER, blocked: true }, hid);

    expect(view.recipes.map((c) => c.id)).toEqual([blocked.id]);
    expect(view.total).toBe(3);
  });

  it('getRecipeDetail returns one entry per distinct ingredient with pref and impact', async () => {
    const hid = await newHousehold();
    const target = await insertTestRecipe(hid, {
      meal_types: ['cena'],
      ingredients: [ONION, SALT_DUP, { ...SALT_DUP, display_name: 'Sale grosso' }],
    });
    await insertTestRecipe(hid, { meal_types: ['cena'], ingredients: [ONION] });
    await insertTestRecipe(hid, { meal_types: ['cena'], ingredients: [ONION], prefs: { blocked: true } });
    await upsertIngredientPref(db, hid, 'cipolla', 'dislike');

    const detail = await getRecipeDetail(target.id, hid);

    expect(detail).not.toBeNull();
    expect(RecipeDetailViewSchema.safeParse(JSON.parse(JSON.stringify(detail))).success).toBe(true);
    expect(detail!.recipe.id).toBe(target.id);
    expect(detail!.ingredients).toEqual([
      { canonical_name: 'cipolla', pref: 'dislike', recipes_count: 2 },
      { canonical_name: 'sale', pref: null, recipes_count: 1 },
    ]);
  });

  it('getRecipeDetail returns null for a recipe of another household', async () => {
    const mine = await newHousehold();
    const other = await newHousehold();
    const foreign = await insertTestRecipe(other, { meal_types: ['cena'] });

    expect(await getRecipeDetail(foreign.id, mine)).toBeNull();
  });

  it('getRecipeDetail returns null for an unknown id', async () => {
    const hid = await newHousehold();
    expect(await getRecipeDetail(crypto.randomUUID(), hid)).toBeNull();
  });
});
