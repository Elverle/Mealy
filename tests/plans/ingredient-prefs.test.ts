// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { db } from '@/lib/db';
import { upsertIngredientPref } from '@/lib/db/repositories/ingredient-pref-repo';
import { createRng } from '@/lib/domain/rng';
import { PlanError } from '@/lib/plans/errors';
import { generatePlan, swapSlot, type GenerateRecipesFn } from '@/lib/plans/service';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { insertTestRecipes } from '@/tests/helpers/plans';

const WED = () => new Date('2026-09-30T10:00:00Z'); // 5 giorni rimasti, solo cena => 5 slot
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const DB_TEST_TIMEOUT_MS = 60_000;

const ONION = {
  canonical_name: 'cipolla',
  display_name: 'cipolla',
  qty: 1,
  unit: 'pz' as const,
  category: 'ortofrutta' as const,
};

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('plans honour ingredient preferences', { timeout: DB_TEST_TIMEOUT_MS }, () => {
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

  function idleGenerate() {
    return vi.fn<GenerateRecipesFn>(async (input) => ({
      requested: input.count,
      created: [],
      skipped: [],
    }));
  }

  async function planRecipeIds(householdId: string, seed: number, generate: GenerateRecipesFn) {
    const { screen } = await generatePlan({ householdId, now: WED, rng: createRng(seed), generate });
    const plan = screen.view.plan;
    if (!plan) throw new Error('nessun piano generato');
    return plan.slots.map((slot) => slot.recipe?.id ?? null);
  }

  it('never puts a recipe with a disliked ingredient in the plan', async () => {
    const householdId = await newHousehold();
    await insertTestRecipes(householdId, 7, { meal_types: ['cena'] });
    const onionRecipes = await insertTestRecipes(householdId, 3, {
      meal_types: ['cena'],
      ingredients: [ONION],
    });
    const onionIds = new Set(onionRecipes.map((r) => r.id));
    await upsertIngredientPref(db, householdId, 'cipolla', 'dislike');
    const generate = idleGenerate();

    for (const seed of SEEDS) {
      const ids = await planRecipeIds(householdId, seed, generate);
      expect(ids.some((id) => id !== null && onionIds.has(id))).toBe(false);
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it('control: without the dislike the recipes with that ingredient do appear', async () => {
    const householdId = await newHousehold();
    await insertTestRecipes(householdId, 7, { meal_types: ['cena'] });
    const onionRecipes = await insertTestRecipes(householdId, 3, {
      meal_types: ['cena'],
      ingredients: [ONION],
    });
    const onionIds = new Set(onionRecipes.map((r) => r.id));
    const generate = idleGenerate();

    let seen = false;
    for (const seed of SEEDS) {
      const ids = await planRecipeIds(householdId, seed, generate);
      if (ids.some((id) => id !== null && onionIds.has(id))) seen = true;
    }
    expect(seen).toBe(true);
  });

  it('swap does not propose recipes with a disliked ingredient', async () => {
    const householdId = await newHousehold();
    await insertTestRecipes(householdId, 7, { meal_types: ['cena'] });
    const generate = idleGenerate();

    const { screen } = await generatePlan({ householdId, now: WED, rng: createRng(1), generate });
    const plan = screen.view.plan!;
    await upsertIngredientPref(db, householdId, 'sale', 'dislike');

    await expect(
      swapSlot(plan.id, plan.slots[0].id, { exclude_recipe_ids: [] }, {
        householdId,
        now: WED,
        generate,
      })
    ).rejects.toMatchObject({ code: 'no_alternatives' });
    await expect(
      swapSlot(plan.id, plan.slots[0].id, { exclude_recipe_ids: [] }, {
        householdId,
        now: WED,
        generate,
      })
    ).rejects.toBeInstanceOf(PlanError);
  });
});
