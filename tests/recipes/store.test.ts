// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, recipes } from '@/lib/db';
import { insertGeneratedRecipe } from '@/lib/recipes/store';
import { isDbAvailable, assertDbMigrated, createTestHousehold, deleteTestHousehold } from '@/tests/helpers/db';
import { makeGeneratedRecipe } from '@/tests/helpers/recipes';

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('insertGeneratedRecipe', () => {
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

  it("stores the recipe with source 'llm' by default", async () => {
    const householdId = await newHousehold();
    const recipe = await db.transaction((tx) =>
      insertGeneratedRecipe(tx, householdId, makeGeneratedRecipe({ title: 'Store default' }))
    );
    expect(recipe.source).toBe('llm');
  });

  it("stores the recipe with the source passed in options", async () => {
    const householdId = await newHousehold();
    const recipe = await db.transaction((tx) =>
      insertGeneratedRecipe(tx, householdId, makeGeneratedRecipe({ title: 'Store manuale' }), {
        source: 'manual',
      })
    );
    expect(recipe.source).toBe('manual');
  });

  it.each([
    ['default', undefined],
    ['manual source', { source: 'manual' as const }],
  ])('derives the style tags with the %s', async (_label, options) => {
    const householdId = await newHousehold();
    const recipe = await db.transaction((tx) =>
      insertGeneratedRecipe(tx, householdId, makeGeneratedRecipe({ title: 'Store etichette' }), options)
    );
    expect(recipe.tags).toContain('pochi-ingredienti');
  });

  it('stores created_at as the date passed in options', async () => {
    const householdId = await newHousehold();
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const recipe = await db.transaction((tx) =>
      insertGeneratedRecipe(tx, householdId, makeGeneratedRecipe({ title: 'Store data fissa' }), {
        createdAt,
      })
    );

    const [row] = await db.select().from(recipes).where(eq(recipes.id, recipe.id));
    expect(row?.created_at).toEqual(createdAt);
  });
});
