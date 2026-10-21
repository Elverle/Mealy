// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, recipes } from '@/lib/db';
import {
  insertRecipe,
  listUnclassifiedRecipes,
  setRecipeClassification,
  type InsertRecipeInput,
} from '@/lib/db/repositories/recipe-repo';
import type { ClassifyRecipeItem, RecipeClassification } from '@/lib/domain/types';
import { LlmError, classifyRecipes } from '@/lib/llm';
import { classifyPendingRecipes } from '@/lib/recipes/classify';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';
import { createRecordedModel } from '@/tests/helpers/mock-llm';

const dbUp = await isDbAvailable();

const FARINA = {
  canonical_name: 'farina',
  display_name: 'Farina',
  qty: 200,
  unit: 'g' as const,
  category: 'dispensa' as const,
};
const SALE = {
  canonical_name: 'sale',
  display_name: 'Sale',
  qty: null,
  unit: 'qb' as const,
  category: 'dispensa' as const,
};

const EPOCH = Date.UTC(2026, 0, 1);

/** Risposta del modello finto: stesse portate per ogni riferimento del lotto. */
function answer(
  items: readonly ClassifyRecipeItem[],
  courses: RecipeClassification['courses'] = ['secondo']
): RecipeClassification[] {
  return items.map((item) => ({ ref: item.ref, courses, style_tags: ['tradizionale'] }));
}

describe.skipIf(!dbUp)('classifyPendingRecipes', () => {
  let householdIds: string[] = [];

  beforeAll(async () => {
    await assertDbMigrated();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const id of householdIds) await deleteTestHousehold(id);
    householdIds = [];
  });

  async function newHousehold(): Promise<string> {
    const id = await createTestHousehold();
    householdIds.push(id);
    return id;
  }

  /** Ricetta senza portata; `index` fissa l'ordine (created_at crescente). */
  async function insertPending(
    householdId: string,
    index: number,
    overrides: Partial<InsertRecipeInput> = {}
  ): Promise<string> {
    const recipe = await insertRecipe(
      {
        household_id: householdId,
        title: `Ricetta ${index}`,
        slug: `ricetta-${index}-${crypto.randomUUID()}`,
        steps: ['Passo unico.'],
        meal_types: ['pranzo'],
        courses: [],
        servings_base: 2,
        prep_minutes: 20,
        source: 'llm',
        created_at: new Date(EPOCH + index * 1000),
        ...overrides,
      },
      [FARINA, SALE]
    );
    return recipe.id;
  }

  async function readClassification(recipeId: string) {
    const [row] = await db
      .select({ courses: recipes.courses, tags: recipes.tags })
      .from(recipes)
      .where(eq(recipes.id, recipeId));
    return row;
  }

  function makeLogger() {
    return { log: vi.fn(), warn: vi.fn() };
  }

  it('classifies all pending recipes in sequential batches of 10, 10 and 3', async () => {
    const h = await newHousehold();
    const ids = await Promise.all(Array.from({ length: 23 }, (_, i) => insertPending(h, i)));
    let call = 0;
    const classify = vi.fn<typeof classifyRecipes>(async (items) => {
      call += 1;
      return items.map(
        (item): RecipeClassification => ({
          ref: item.ref,
          courses: call === 1 && item.ref === 'r1' ? ['piatto-unico'] : ['secondo'],
          style_tags: ['tradizionale'],
        })
      );
    });
    const logger = makeLogger();

    const report = await classifyPendingRecipes({
      householdId: h,
      model: createRecordedModel([]).model,
      classify,
      logger,
    });

    expect(classify).toHaveBeenCalledTimes(3);
    const batches = classify.mock.calls.map(([items]) => items);
    expect(batches.map((items) => items.length)).toEqual([10, 10, 3]);
    expect(batches[0].map((item) => item.ref)).toEqual([
      'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10',
    ]);
    expect(batches[0][0]).toMatchObject({ title: 'Ricetta 0', meal_types: ['pranzo'], tags: [] });
    expect(batches[0][0].ingredient_names).toEqual(['farina', 'sale']);
    expect(report).toEqual({
      pending: 23,
      classified: 23,
      remaining: 0,
      failedBatches: 0,
      notConfigured: false,
    });
    expect(await listUnclassifiedRecipes(db, h)).toEqual([]);
    expect(await readClassification(ids[0])).toEqual({
      courses: ['piatto-unico'],
      tags: ['piatto-unico', 'tradizionale', 'pochi-ingredienti'],
    });
    expect(await readClassification(ids[1])).toEqual({
      courses: ['secondo'],
      tags: ['tradizionale', 'pochi-ingredienti'],
    });
    expect(logger.log).toHaveBeenCalledWith('[classify] ricette da classificare: 23');
    expect(logger.log).toHaveBeenCalledWith('[classify] classificate: 23, rimaste: 0');
  });

  it('keeps the existing style tags and adds the ones the model returns', async () => {
    const h = await newHousehold();
    const id = await insertPending(h, 0, { tags: ['veloce'] });
    const classify = vi.fn<typeof classifyRecipes>(async (items) => answer(items));

    await classifyPendingRecipes({
      householdId: h,
      model: createRecordedModel([]).model,
      classify,
      logger: makeLogger(),
    });

    expect(await readClassification(id)).toEqual({
      courses: ['secondo'],
      tags: ['veloce', 'tradizionale', 'pochi-ingredienti'],
    });
  });

  it('removes a piatto-unico tag from a recipe the model classifies as secondo', async () => {
    const h = await newHousehold();
    const id = await insertPending(h, 0, { tags: ['piatto-unico'] });
    const classify = vi.fn<typeof classifyRecipes>(async (items) => answer(items, ['secondo']));

    await classifyPendingRecipes({
      householdId: h,
      model: createRecordedModel([]).model,
      classify,
      logger: makeLogger(),
    });

    const row = await readClassification(id);
    expect(row.courses).toEqual(['secondo']);
    expect(row.tags).not.toContain('piatto-unico');
  });

  it('keeps going after a failed batch and leaves its recipes unclassified', async () => {
    const h = await newHousehold();
    const ids = await Promise.all(Array.from({ length: 23 }, (_, i) => insertPending(h, i)));
    const classify = vi.fn<typeof classifyRecipes>();
    classify
      .mockImplementationOnce(async (items) => answer(items))
      .mockRejectedValueOnce(new LlmError('timeout', 'Chiamata LLM scaduta'))
      .mockImplementationOnce(async (items) => answer(items));
    const logger = makeLogger();

    const report = await classifyPendingRecipes({
      householdId: h,
      model: createRecordedModel([]).model,
      classify,
      logger,
    });

    expect(report).toEqual({
      pending: 23,
      classified: 13,
      remaining: 10,
      failedBatches: 1,
      notConfigured: false,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[classify\] lotto 2\/3 non classificato: timeout/)
    );
    expect((await listUnclassifiedRecipes(db, h)).map((r) => r.id)).toEqual(ids.slice(10, 20));
    expect(await readClassification(ids[10])).toEqual({ courses: [], tags: [] });
  });

  it('reports a generic error from a batch with its message', async () => {
    const h = await newHousehold();
    await insertPending(h, 0);
    const classify = vi.fn<typeof classifyRecipes>(async () => {
      throw new Error('rete assente');
    });
    const logger = makeLogger();

    const report = await classifyPendingRecipes({
      householdId: h,
      model: createRecordedModel([]).model,
      classify,
      logger,
    });

    expect(report.failedBatches).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith('[classify] lotto 1/1 non classificato: rete assente');
  });

  it('ignores rows with an unknown ref, a repeated ref (first wins) and empty courses', async () => {
    const h = await newHousehold();
    const first = await insertPending(h, 0);
    const second = await insertPending(h, 1);
    const classify = vi.fn<typeof classifyRecipes>(async () => [
      { ref: 'r99', courses: ['primo'], style_tags: [] },
      { ref: 'r1', courses: ['primo'], style_tags: [] },
      { ref: 'r1', courses: ['secondo'], style_tags: [] },
      { ref: 'r2', courses: [], style_tags: ['tradizionale'] },
    ]);

    const report = await classifyPendingRecipes({
      householdId: h,
      model: createRecordedModel([]).model,
      classify,
      logger: makeLogger(),
      batchSize: 2,
    });

    expect(report).toMatchObject({ pending: 2, classified: 1, remaining: 1 });
    expect(await readClassification(first)).toEqual({ courses: ['primo'], tags: ['pochi-ingredienti'] });
    expect(await readClassification(second)).toEqual({ courses: [], tags: [] });
  });

  it('does not overwrite a recipe classified while its batch was in flight', async () => {
    const h = await newHousehold();
    const id = await insertPending(h, 0);
    const classify = vi.fn<typeof classifyRecipes>(async (items) => {
      await setRecipeClassification(db, id, ['primo'], []);
      return answer(items, ['secondo']);
    });

    const report = await classifyPendingRecipes({
      householdId: h,
      model: createRecordedModel([]).model,
      classify,
      logger: makeLogger(),
    });

    expect(await readClassification(id)).toEqual({ courses: ['primo'], tags: [] });
    expect(report).toMatchObject({ pending: 1, classified: 0, remaining: 1 });
  });

  it('does not call the model when it is not configured and reports notConfigured', async () => {
    const h = await newHousehold();
    await insertPending(h, 0);
    await insertPending(h, 1);
    vi.stubEnv('LLM_MODEL', '');
    const classify = vi.fn<typeof classifyRecipes>(async (items) => answer(items));
    const logger = makeLogger();

    const report = await classifyPendingRecipes({ householdId: h, classify, logger });

    expect(classify).not.toHaveBeenCalled();
    expect(report).toEqual({
      pending: 2,
      classified: 0,
      remaining: 2,
      failedBatches: 0,
      notConfigured: true,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[classify\] modello non configurato \(.+\): 2 ricette restano senza portata$/)
    );
  });

  it('logs that there is nothing to do, without resolving the model, when no recipe is pending', async () => {
    const h = await newHousehold();
    await insertRecipe({
      household_id: h,
      title: 'Già classificata',
      slug: `gia-classificata-${crypto.randomUUID()}`,
      steps: ['Passo unico.'],
      meal_types: ['pranzo'],
      courses: ['primo'],
      servings_base: 2,
      prep_minutes: 20,
      source: 'manual',
    });
    const classify = vi.fn<typeof classifyRecipes>(async (items) => answer(items));
    const logger = makeLogger();

    const report = await classifyPendingRecipes({ householdId: h, classify, logger });

    expect(classify).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('[classify] nessuna ricetta da classificare');
    expect(report).toEqual({
      pending: 0,
      classified: 0,
      remaining: 0,
      failedBatches: 0,
      notConfigured: false,
    });
  });

  it('rejects a batch size outside 1..CLASSIFY_BATCH_SIZE before calling the model', async () => {
    const h = await newHousehold();
    await insertPending(h, 0);
    const classify = vi.fn<typeof classifyRecipes>(async (items) => answer(items));

    await expect(
      classifyPendingRecipes({
        householdId: h,
        model: createRecordedModel([]).model,
        classify,
        logger: makeLogger(),
        batchSize: 0,
      })
    ).rejects.toThrow(RangeError);
    expect(classify).not.toHaveBeenCalled();
  });
});
