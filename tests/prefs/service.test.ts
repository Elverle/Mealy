// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, recipe_prefs } from '@/lib/db';
import {
  listIngredientPrefs,
  setIngredientPref,
  updateRecipePref,
} from '@/lib/prefs/service';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { insertTestRecipe } from '@/tests/helpers/plans';

const DB_TEST_TIMEOUT_MS = 60_000;
const NAME_TOO_LONG = 'a'.repeat(81);

function ingredient(name: string) {
  return {
    canonical_name: name,
    display_name: name,
    qty: 1,
    unit: 'pz' as const,
    category: 'ortofrutta' as const,
  };
}

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('prefs service', { timeout: DB_TEST_TIMEOUT_MS }, () => {
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

  describe('updateRecipePref', () => {
    it('keeps favorite when rating is set afterwards', async () => {
      const hid = await newHousehold();
      const recipe = await insertTestRecipe(hid, { meal_types: ['cena'] });

      await updateRecipePref(recipe.id, { favorite: true }, hid);
      const result = await updateRecipePref(recipe.id, { rating: 4 }, hid);

      expect(result).toMatchObject({ recipe_id: recipe.id, rating: 4, favorite: true, blocked: false });
    });

    it('blocking a favorite removes it from favorites', async () => {
      const hid = await newHousehold();
      const recipe = await insertTestRecipe(hid, { meal_types: ['cena'], prefs: { favorite: true } });

      const result = await updateRecipePref(recipe.id, { blocked: true }, hid);

      expect(result).toMatchObject({ blocked: true, favorite: false });
    });

    it('rating null clears the rating', async () => {
      const hid = await newHousehold();
      const recipe = await insertTestRecipe(hid, { meal_types: ['cena'], prefs: { rating: 5 } });

      const result = await updateRecipePref(recipe.id, { rating: null }, hid);

      expect(result?.rating).toBeNull();
    });

    it('does not change times_used', async () => {
      const hid = await newHousehold();
      const recipe = await insertTestRecipe(hid, { meal_types: ['cena'], prefs: { times_used: 3 } });

      const result = await updateRecipePref(recipe.id, { favorite: true }, hid);

      expect(result?.times_used).toBe(3);
    });

    it('creates the pref row when the recipe has none', async () => {
      const hid = await newHousehold();
      const recipe = await insertTestRecipe(hid, { meal_types: ['cena'] });

      const result = await updateRecipePref(recipe.id, { rating: 2 }, hid);

      expect(result).toMatchObject({ rating: 2, favorite: false, blocked: false, times_used: 0 });
    });

    it('returns null and writes nothing for a recipe of another household', async () => {
      const mine = await newHousehold();
      const other = await newHousehold();
      const foreign = await insertTestRecipe(other, { meal_types: ['cena'] });

      const result = await updateRecipePref(foreign.id, { favorite: true }, mine);

      expect(result).toBeNull();
      const rows = await db.select().from(recipe_prefs).where(eq(recipe_prefs.recipe_id, foreign.id));
      // insertRecipe crea già una riga di default: deve restare intatta.
      expect(rows.every((row) => !row.favorite)).toBe(true);
    });
  });

  describe('setIngredientPref', () => {
    it('normalizes the name, stores it and returns the impact count', async () => {
      const hid = await newHousehold();
      await insertTestRecipe(hid, { meal_types: ['cena'], ingredients: [ingredient('cipolla')] });
      await insertTestRecipe(hid, { meal_types: ['cena'], ingredients: [ingredient('cipolla')] });
      await insertTestRecipe(hid, {
        meal_types: ['cena'],
        ingredients: [ingredient('cipolla')],
        prefs: { blocked: true },
      });

      const result = await setIngredientPref(' Cipolla ', 'dislike', hid);

      expect(result).toEqual({ canonical_name: 'cipolla', pref: 'dislike', recipes_count: 2 });
      const view = await listIngredientPrefs(hid);
      expect(view.dislikes.map((e) => e.canonical_name)).toEqual(['cipolla']);
    });

    it('switches from dislike to like', async () => {
      const hid = await newHousehold();
      await setIngredientPref('cipolla', 'dislike', hid);

      const result = await setIngredientPref('cipolla', 'like', hid);

      expect(result.pref).toBe('like');
      const view = await listIngredientPrefs(hid);
      expect(view.dislikes).toEqual([]);
      expect(view.likes.map((e) => e.canonical_name)).toEqual(['cipolla']);
    });

    it('null removes the pref', async () => {
      const hid = await newHousehold();
      await setIngredientPref('cipolla', 'like', hid);

      const result = await setIngredientPref('cipolla', null, hid);

      expect(result).toEqual({ canonical_name: 'cipolla', pref: null, recipes_count: 0 });
      expect(await listIngredientPrefs(hid)).toEqual({ likes: [], dislikes: [] });
    });

    it('null on a never-judged name does not fail', async () => {
      const hid = await newHousehold();
      await expect(setIngredientPref('mai visto', null, hid)).resolves.toMatchObject({ pref: null });
    });

    it('rejects an empty name and an 81-character name with RangeError', async () => {
      const hid = await newHousehold();
      await expect(setIngredientPref('   ', 'like', hid)).rejects.toBeInstanceOf(RangeError);
      await expect(setIngredientPref(NAME_TOO_LONG, 'like', hid)).rejects.toBeInstanceOf(RangeError);
    });
  });

  describe('listIngredientPrefs', () => {
    it('returns two alphabetical lists with counts', async () => {
      const hid = await newHousehold();
      await insertTestRecipe(hid, { meal_types: ['cena'], ingredients: [ingredient('zucchina')] });
      await setIngredientPref('zucchina', 'like', hid);
      await setIngredientPref('basilico', 'like', hid);
      await setIngredientPref('uova', 'dislike', hid);
      await setIngredientPref('cipolla', 'dislike', hid);

      const view = await listIngredientPrefs(hid);

      expect(view.likes).toEqual([
        { canonical_name: 'basilico', pref: 'like', recipes_count: 0 },
        { canonical_name: 'zucchina', pref: 'like', recipes_count: 1 },
      ]);
      expect(view.dislikes.map((e) => e.canonical_name)).toEqual(['cipolla', 'uova']);
    });

    it('does not leak prefs of other households', async () => {
      const mine = await newHousehold();
      const other = await newHousehold();
      await setIngredientPref('cipolla', 'dislike', other);

      expect(await listIngredientPrefs(mine)).toEqual({ likes: [], dislikes: [] });
    });
  });
});
