// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, recipe_prefs } from '@/lib/db';
import {
  lockRecipePref,
  recipeBelongsToHousehold,
  writeRecipePref,
} from '@/lib/db/repositories/recipe-repo';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { insertTestRecipe } from '@/tests/helpers/plans';

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('recipe pref repository additions', () => {
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

  describe('recipeBelongsToHousehold', () => {
    it('is true for a recipe of the household', async () => {
      const h = await newHousehold();
      const recipe = await insertTestRecipe(h, { meal_types: ['cena'] });
      expect(await recipeBelongsToHousehold(db, recipe.id, h)).toBe(true);
    });

    it('is false for a recipe of another household', async () => {
      const h = await newHousehold();
      const other = await newHousehold();
      const recipe = await insertTestRecipe(h, { meal_types: ['cena'] });
      expect(await recipeBelongsToHousehold(db, recipe.id, other)).toBe(false);
    });

    it('is false for an unknown recipe id', async () => {
      const h = await newHousehold();
      expect(await recipeBelongsToHousehold(db, crypto.randomUUID(), h)).toBe(false);
    });
  });

  describe('lockRecipePref', () => {
    it('returns the pref row inside a transaction', async () => {
      const h = await newHousehold();
      const recipe = await insertTestRecipe(h, {
        meal_types: ['cena'],
        prefs: { rating: 4, favorite: true },
      });

      const pref = await db.transaction((tx) => lockRecipePref(tx, recipe.id));
      expect(pref).toMatchObject({ recipe_id: recipe.id, rating: 4, favorite: true, blocked: false });
    });

    it('returns null when the pref row is missing', async () => {
      const h = await newHousehold();
      const recipe = await insertTestRecipe(h, { meal_types: ['cena'] });
      await db.delete(recipe_prefs).where(eq(recipe_prefs.recipe_id, recipe.id));

      const pref = await db.transaction((tx) => lockRecipePref(tx, recipe.id));
      expect(pref).toBeNull();
    });
  });

  describe('writeRecipePref', () => {
    it('updates rating, favorite and blocked while preserving usage tracking', async () => {
      const h = await newHousehold();
      const lastUsed = new Date('2026-09-01T12:00:00Z');
      const recipe = await insertTestRecipe(h, {
        meal_types: ['cena'],
        prefs: { times_used: 3, last_used_at: lastUsed },
      });

      const written = await writeRecipePref(db, recipe.id, {
        rating: 5,
        favorite: true,
        blocked: false,
      });
      expect(written).toMatchObject({ rating: 5, favorite: true, blocked: false, times_used: 3 });
      expect(written.last_used_at?.getTime()).toBe(lastUsed.getTime());

      const again = await writeRecipePref(db, recipe.id, {
        rating: null,
        favorite: false,
        blocked: true,
      });
      expect(again).toMatchObject({ rating: null, favorite: false, blocked: true, times_used: 3 });
      expect(again.last_used_at?.getTime()).toBe(lastUsed.getTime());
    });

    it('creates the pref row when it is missing', async () => {
      const h = await newHousehold();
      const recipe = await insertTestRecipe(h, { meal_types: ['cena'] });
      await db.delete(recipe_prefs).where(eq(recipe_prefs.recipe_id, recipe.id));

      const written = await writeRecipePref(db, recipe.id, {
        rating: 2,
        favorite: false,
        blocked: false,
      });

      expect(written).toMatchObject({
        recipe_id: recipe.id,
        rating: 2,
        favorite: false,
        blocked: false,
        times_used: 0,
        last_used_at: null,
      });
    });
  });
});
