// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { db } from '@/lib/db';
import { upsertIngredientPref } from '@/lib/db/repositories/ingredient-pref-repo';
import { listRecipes } from '@/lib/db/repositories/recipe-repo';
import { selectRecipes } from '@/lib/domain/planner';
import { createRng } from '@/lib/domain/rng';
import { loadIngredientPreferences } from '@/lib/prefs/ingredient-prefs';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { insertTestRecipe } from '@/tests/helpers/plans';

const dbUp = await isDbAvailable();

const DRAWS = 4000;
const RATIO_MIN = 1.15;
const RATIO_MAX = 1.45;

describe.skipIf(!dbUp)('loadIngredientPreferences', () => {
  let householdIds: string[] = [];

  beforeAll(async () => {
    await assertDbMigrated();
  });

  afterEach(async () => {
    for (const id of householdIds) await deleteTestHousehold(id);
    householdIds = [];
  });

  async function newHousehold(): Promise<string> {
    const id = await createTestHousehold({ meals: ['cena'] });
    householdIds.push(id);
    return id;
  }

  it('returns two empty sets when the household has no judgments', async () => {
    const id = await newHousehold();
    const prefs = await loadIngredientPreferences(id);
    expect(prefs.likes.size).toBe(0);
    expect(prefs.dislikes.size).toBe(0);
  });

  it('splits likes and dislikes into the right sets', async () => {
    const id = await newHousehold();
    await upsertIngredientPref(db, id, 'basilico', 'like');
    await upsertIngredientPref(db, id, 'pomodoro', 'like');
    await upsertIngredientPref(db, id, 'cipolla', 'dislike');

    const prefs = await loadIngredientPreferences(id);
    expect([...prefs.likes].sort()).toEqual(['basilico', 'pomodoro']);
    expect([...prefs.dislikes]).toEqual(['cipolla']);
  });

  it('works with a transaction as executor and sees its uncommitted writes', async () => {
    const id = await newHousehold();
    await db.transaction(async (tx) => {
      await upsertIngredientPref(tx, id, 'cipolla', 'dislike');
      const inTx = await loadIngredientPreferences(id, tx);
      expect([...inTx.dislikes]).toEqual(['cipolla']);
    });
    const after = await loadIngredientPreferences(id);
    expect([...after.dislikes]).toEqual(['cipolla']);
  });

  it('does not leak judgments across households', async () => {
    const a = await newHousehold();
    const b = await newHousehold();
    await upsertIngredientPref(db, a, 'cipolla', 'dislike');

    const prefs = await loadIngredientPreferences(b);
    expect(prefs.dislikes.size).toBe(0);
  });

  it('makes recipes with liked ingredients more frequent in the statistical draw', async () => {
    const id = await newHousehold();
    const recipeA = await insertTestRecipe(id, {
      meal_types: ['cena'],
      ingredients: [
        { canonical_name: 'basilico', display_name: 'basilico', qty: null, unit: 'qb', category: 'ortofrutta' },
        { canonical_name: 'pomodoro', display_name: 'pomodoro', qty: 200, unit: 'g', category: 'ortofrutta' },
      ],
    });
    const recipeB = await insertTestRecipe(id, { meal_types: ['cena'] });
    await upsertIngredientPref(db, id, 'basilico', 'like');
    await upsertIngredientPref(db, id, 'pomodoro', 'like');

    const ingredientPrefs = await loadIngredientPreferences(id);
    const candidates = await listRecipes({ household_id: id });
    const rng = createRng(1);
    const now = new Date('2026-09-30T10:00:00Z');

    let countA = 0;
    let countB = 0;
    for (let i = 0; i < DRAWS; i++) {
      const { assignments } = selectRecipes({
        household: { diet_tags: [], appliances: ['fornelli', 'forno', 'microonde', 'friggitrice-ad-aria', 'frullatore'] },
        ingredientPrefs,
        excludeRecipeIds: new Set<string>(),
        slots: [{ key: 's', day: '2026-09-30', meal: 'cena' }],
        candidates,
        now,
        rng,
      });
      if (assignments[0].recipeId === recipeA.id) countA++;
      else if (assignments[0].recipeId === recipeB.id) countB++;
    }

    expect(countA + countB).toBe(DRAWS);
    const ratio = countA / countB;
    expect(ratio).toBeGreaterThan(RATIO_MIN);
    expect(ratio).toBeLessThan(RATIO_MAX);
  });
});
