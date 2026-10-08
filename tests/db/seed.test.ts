// @vitest-environment node

import { describe, it, expect, beforeAll } from 'vitest';
import { isDbAvailable, assertDbMigrated } from '@/tests/helpers/db';
import { seedDatabase, seedIngredientAliases } from '@/lib/db/seed-core';
import { getRecipeById } from '@/lib/db/repositories/recipe-repo';
import { FIXTURE_RECIPES, FIXTURE_INGREDIENT_ALIASES } from '@/fixtures';
import { client, db, ingredient_aliases, recipes } from '@/lib/db';
import { count, eq } from 'drizzle-orm';

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('Database Seeding', () => {
  beforeAll(async () => {
    await assertDbMigrated();
  });

  it('runs seedDatabase twice idempotently', async () => {
    const firstReport = await seedDatabase();
    expect(firstReport.household).toMatch(/^(created|existing)$/);
    expect(firstReport.recipesInserted + firstReport.recipesSkipped).toBe(18);

    const secondReport = await seedDatabase();
    expect(secondReport.household).toBe('existing');
    expect(secondReport.recipesInserted).toBe(0);
    expect(secondReport.recipesSkipped).toBe(18);
    expect(secondReport.aliasesInserted).toBe(0);
  });

  it('verifies all fixture recipes exist with ingredients and default preferences', async () => {
    for (const fixture of FIXTURE_RECIPES) {
      const dbRecipe = await getRecipeById(fixture.id);
      expect(dbRecipe).not.toBeNull();
      expect(dbRecipe!.id).toBe(fixture.id);
      expect(dbRecipe!.slug).toBe(fixture.slug);
      expect(dbRecipe!.title).toBe(fixture.title);
      expect(dbRecipe!.ingredients).toHaveLength(fixture.ingredients.length);
      expect(dbRecipe!.prefs).not.toBeNull();
      expect(dbRecipe!.prefs!.favorite).toBe(false);
      expect(dbRecipe!.prefs!.times_used).toBe(0);
    }
  });

  it('verifies every alias from fixtures exists in ingredient_aliases table', async () => {
    for (const aliasItem of FIXTURE_INGREDIENT_ALIASES) {
      const found = await db.query.ingredient_aliases.findFirst({
        where: eq(ingredient_aliases.alias, aliasItem.alias),
      });
      expect(found).toBeDefined();
      expect(found!.canonical_name).toBe(aliasItem.canonical_name);
    }
  });

  it('verifies no pair of fixture titles has similarity > 0.6 via pg_trgm', async () => {
    const ids = FIXTURE_RECIPES.map((r) => r.id);
    const rows = await client<{ title_a: string; title_b: string; sim: number }[]>`
      select a.title as title_a, b.title as title_b, similarity(a.title, b.title) as sim
      from recipes a
      join recipes b on a.id < b.id
      where a.id = any(${ids}) and b.id = any(${ids}) and similarity(a.title, b.title) > 0.6
    `;
    expect(rows).toHaveLength(0);
  });

  it('seedIngredientAliases is idempotent and inserts no recipes', async () => {
    // Repeatable read: the snapshot ignores recipes written concurrently by other
    // test files, while writes made inside this transaction remain visible to it.
    await db.transaction(
      async (tx) => {
        const [{ value: recipesBefore }] = await tx.select({ value: count() }).from(recipes);

        await seedIngredientAliases(tx);
        const second = await seedIngredientAliases(tx);

        const [{ value: recipesAfter }] = await tx.select({ value: count() }).from(recipes);
        expect(second).toBe(0);
        expect(recipesAfter).toBe(recipesBefore);
      },
      { isolationLevel: 'repeatable read' },
    );
  });
});
