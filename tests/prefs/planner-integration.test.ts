// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createRng } from '@/lib/domain/rng';
import { generatePlan, type GenerateRecipesFn } from '@/lib/plans/service';
import { setIngredientPref, updateRecipePref } from '@/lib/prefs/service';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { insertTestRecipes } from '@/tests/helpers/plans';

const WED = () => new Date('2026-09-30T10:00:00Z'); // 5 giorni rimasti, solo cena => 5 slot
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const DB_TEST_TIMEOUT_MS = 120_000;

const ONION = {
  canonical_name: 'cipolla',
  display_name: 'cipolla',
  qty: 1,
  unit: 'pz' as const,
  category: 'ortofrutta' as const,
};

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('prefs services drive the planner', { timeout: DB_TEST_TIMEOUT_MS }, () => {
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

  const generate = vi.fn<GenerateRecipesFn>(async (input) => ({
    requested: input.count,
    created: [],
    skipped: [],
  }));

  /** Id delle ricette presenti in ognuno dei 20 piani seedati. */
  async function plannedIdsAcrossSeeds(householdId: string): Promise<Set<string>> {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const { screen } = await generatePlan({ householdId, now: WED, rng: createRng(seed), generate });
      const plan = screen.view.plan;
      if (!plan) throw new Error('nessun piano generato');
      for (const slot of plan.slots) if (slot.recipe) seen.add(slot.recipe.id);
    }
    return seen;
  }

  it('a recipe blocked through the service never enters a plan, and returns once unblocked', async () => {
    const householdId = await newHousehold();
    const recipes = await insertTestRecipes(householdId, 8, { meal_types: ['cena'] });
    const target = recipes[0].id;

    await updateRecipePref(target, { blocked: true }, householdId);
    expect((await plannedIdsAcrossSeeds(householdId)).has(target)).toBe(false);

    await updateRecipePref(target, { blocked: false }, householdId);
    expect((await plannedIdsAcrossSeeds(householdId)).has(target)).toBe(true);
  });

  it('a disliked ingredient set through the service excludes its recipes, and removing it restores them', async () => {
    const householdId = await newHousehold();
    await insertTestRecipes(householdId, 7, { meal_types: ['cena'] });
    const onionRecipes = await insertTestRecipes(householdId, 3, {
      meal_types: ['cena'],
      ingredients: [ONION],
    });
    const onionIds = onionRecipes.map((r) => r.id);

    await setIngredientPref('cipolla', 'dislike', householdId);
    const withDislike = await plannedIdsAcrossSeeds(householdId);
    expect(onionIds.some((id) => withDislike.has(id))).toBe(false);

    await setIngredientPref('cipolla', null, householdId);
    const withoutDislike = await plannedIdsAcrossSeeds(householdId);
    expect(onionIds.some((id) => withoutDislike.has(id))).toBe(true);
  });
});
