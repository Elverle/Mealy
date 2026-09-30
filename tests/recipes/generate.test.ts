// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { db } from '@/lib/db';
import { insertRecipe, listRecipeTitles } from '@/lib/db/repositories/recipe-repo';
import { APPLIANCE_VALUES } from '@/lib/domain/types';
import { LlmError } from '@/lib/llm/errors';
import { generateAndStoreRecipes } from '@/lib/recipes/generate';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { createRecordedModel, loadLlmRecording } from '@/tests/helpers/mock-llm';

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('generateAndStoreRecipes', () => {
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

  async function createHousehold(
    overrides?: Parameters<typeof createTestHousehold>[0]
  ): Promise<string> {
    const id = await createTestHousehold(overrides);
    createdHouseholdIds.push(id);
    return id;
  }

  it('handles mixed batch: 1 created, 4 skipped with exact reasons, and exclude-list passed to model', async () => {
    const householdId = await createHousehold({
      appliances: ['fornelli', 'friggitrice-ad-aria'],
      diet_tags: [],
    });

    await insertRecipe({
      household_id: householdId,
      title: 'Pasta al pomodoro',
      slug: `pasta-al-pomodoro-${crypto.randomUUID().slice(0, 8)}`,
      description: 'Pasta semplice al pomodoro',
      steps: ['Lessa la pasta.', 'Condisci con pomodoro.'],
      meal_types: ['pranzo', 'cena'],
      appliances_required: ['fornelli'],
      servings_base: 2,
      prep_minutes: 15,
    });

    const recorded = loadLlmRecording('generation-mixed');
    const { model, calls } = createRecordedModel([recorded]);

    const result = await generateAndStoreRecipes(
      {
        householdId,
        count: 5,
        mealType: 'cena',
      },
      { model }
    );

    expect(result.requested).toBe(5);
    expect(result.created.length).toBe(1);

    const created = result.created[0];
    expect(created.title).toBe('Ceci croccanti in friggitrice ad aria');
    expect(created.source).toBe('llm');
    expect(created.ingredients.length).toBe(3);
    expect(created.prefs).toBeDefined();
    expect(created.prefs?.favorite).toBe(false);
    expect(created.prefs?.blocked).toBe(false);
    expect(created.prefs?.times_used).toBe(0);

    expect(result.skipped).toEqual([
      {
        title: 'Pasta al Pomodoro!',
        reason: 'duplicate',
        detail: 'titolo già presente in libreria',
      },
      {
        title: 'Pasta al pomodoro fresco',
        reason: 'duplicate',
        detail: 'simile a "Pasta al pomodoro"',
      },
      {
        title: 'Lasagne vegetali al forno',
        reason: 'constraint_violation',
        detail: 'richiede "forno" non disponibile',
      },
      {
        title: 'ceci croccanti in friggitrice ad aria',
        reason: 'duplicate',
        detail: 'titolo già presente in libreria',
      },
    ]);

    expect(calls.length).toBe(1);
    expect(JSON.stringify(calls[0])).toContain('Pasta al pomodoro');
  });

  it('two consecutive calls do not produce duplicates', async () => {
    const householdId = await createHousehold({
      appliances: [...APPLIANCE_VALUES],
      diet_tags: [],
    });

    const recording = loadLlmRecording('valid-2-recipes');

    // First call
    const model1 = createRecordedModel([recording]).model;
    const result1 = await generateAndStoreRecipes(
      {
        householdId,
        count: 2,
        mealType: 'cena',
      },
      { model: model1 }
    );

    expect(result1.created.length).toBe(2);
    expect(result1.skipped.length).toBe(0);

    // Second call with identical generation
    const model2 = createRecordedModel([recording]).model;
    const result2 = await generateAndStoreRecipes(
      {
        householdId,
        count: 2,
        mealType: 'cena',
      },
      { model: model2 }
    );

    expect(result2.created.length).toBe(0);
    expect(result2.skipped.length).toBe(2);
    expect(result2.skipped[0].reason).toBe('duplicate');
    expect(result2.skipped[1].reason).toBe('duplicate');

    const titlesInDb = await listRecipeTitles(db, householdId);
    expect(titlesInDb.length).toBe(2);
  });

  it('resolves slug collision by appending numeric suffix', async () => {
    const household1 = await createHousehold({
      appliances: ['fornelli', 'friggitrice-ad-aria'],
      diet_tags: [],
    });
    const household2 = await createHousehold();

    // Pre-insert recipe in household 2 with colliding slug
    await insertRecipe({
      household_id: household2,
      title: 'Ricetta segnaposto',
      slug: 'ceci-croccanti-in-friggitrice-ad-aria',
      steps: ['Passo unico'],
      meal_types: ['cena'],
      appliances_required: ['friggitrice-ad-aria'],
      servings_base: 2,
      prep_minutes: 10,
    });

    // Also pre-insert Pasta al pomodoro in household 1 for the mixed batch
    await insertRecipe({
      household_id: household1,
      title: 'Pasta al pomodoro',
      slug: `pasta-al-pomodoro-${crypto.randomUUID().slice(0, 8)}`,
      steps: ['Lessa la pasta.'],
      meal_types: ['cena'],
      appliances_required: ['fornelli'],
      servings_base: 2,
      prep_minutes: 15,
    });

    const recorded = loadLlmRecording('generation-mixed');
    const { model } = createRecordedModel([recorded]);

    const result = await generateAndStoreRecipes(
      {
        householdId: household1,
        count: 5,
        mealType: 'cena',
      },
      { model }
    );

    expect(result.created.length).toBe(1);
    expect(result.created[0].slug).toBe('ceci-croccanti-in-friggitrice-ad-aria-2');
  });

  it('propagates LLM error and inserts zero recipes into database', async () => {
    const householdId = await createHousehold();

    const failingGenerate = vi.fn().mockRejectedValue(new LlmError('provider', 'Mock provider error'));

    await expect(
      generateAndStoreRecipes(
        {
          householdId,
          count: 3,
          mealType: 'cena',
        },
        { generate: failingGenerate }
      )
    ).rejects.toThrow(LlmError);

    const titlesInDb = await listRecipeTitles(db, householdId);
    expect(titlesInDb.length).toBe(0);
  });

  it('correctly propagates constraints and overrides to generator function', async () => {
    const householdId = await createHousehold({
      persons: 2,
      diet_tags: ['vegetariano'],
      appliances: ['fornelli', 'forno'],
    });

    const spyGenerate = vi.fn().mockResolvedValue([]);

    const result = await generateAndStoreRecipes(
      {
        householdId,
        count: 3,
        mealType: 'pranzo',
        overrides: {
          persons: 4,
          appliances: ['friggitrice-ad-aria'],
        },
      },
      { generate: spyGenerate }
    );

    expect(spyGenerate).toHaveBeenCalledTimes(1);
    const [calledConstraints, calledCount] = spyGenerate.mock.calls[0];

    expect(calledCount).toBe(3);
    expect(calledConstraints).toEqual({
      persons: 4,
      meal_type: 'pranzo',
      diet_tags: ['vegetariano'],
      meal_style_tags: expect.any(Array),
      appliances: ['friggitrice-ad-aria'],
      ingredient_likes: [],
      ingredient_dislikes: [],
    });

    expect(result).toEqual({
      requested: 3,
      created: [],
      skipped: [],
    });
  });
});
