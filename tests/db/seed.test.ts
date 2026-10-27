// @vitest-environment node

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { isDbAvailable, assertDbMigrated } from '@/tests/helpers/db';
import { seedDatabase, seedIngredientAliases } from '@/lib/db/seed-core';
import * as recipeRepo from '@/lib/db/repositories/recipe-repo';
import { getRecipeById } from '@/lib/db/repositories/recipe-repo';
import { FIXTURE_RECIPES, FIXTURE_INGREDIENT_ALIASES } from '@/fixtures';
import { client, db, ingredient_aliases, recipes } from '@/lib/db';
import { normalizeCourses, deriveStyleTags } from '@/lib/domain/courses';
import { count, eq, inArray } from 'drizzle-orm';

const dbUp = await isDbAvailable();

describe.skipIf(!dbUp)('Database Seeding', () => {
  beforeAll(async () => {
    await assertDbMigrated();
  });

  it('runs seedDatabase twice idempotently', async () => {
    const firstReport = await seedDatabase();
    expect(firstReport.household).toMatch(/^(created|existing)$/);
    expect(firstReport.recipesInserted + firstReport.recipesSkipped).toBe(FIXTURE_RECIPES.length);

    const secondReport = await seedDatabase();
    expect(secondReport.household).toBe('existing');
    expect(secondReport.recipesInserted).toBe(0);
    expect(secondReport.recipesSkipped).toBe(FIXTURE_RECIPES.length);
    expect(secondReport.recipesClassified).toBe(0);
    expect(secondReport.aliasesInserted).toBe(0);
  });

  it('verifies all fixture recipes exist with ingredients and a preferences row', async () => {
    // Solo la presenza della riga: preferita e utilizzi cambiano con le prove manuali sul DB di
    // sviluppo, e il seed non li tocca mai su una ricetta già presente.
    for (const fixture of FIXTURE_RECIPES) {
      const dbRecipe = await getRecipeById(fixture.id);
      expect(dbRecipe).not.toBeNull();
      expect(dbRecipe!.id).toBe(fixture.id);
      expect(dbRecipe!.slug).toBe(fixture.slug);
      expect(dbRecipe!.title).toBe(fixture.title);
      expect(dbRecipe!.ingredients).toHaveLength(fixture.ingredients.length);
      expect(dbRecipe!.prefs).not.toBeNull();
    }
  });

  it('after seeding every fixture recipe has at least one course', async () => {
    for (const fixture of FIXTURE_RECIPES) {
      const dbRecipe = await getRecipeById(fixture.id);
      expect(dbRecipe!.courses.length).toBeGreaterThan(0);
      expect(dbRecipe!.courses).toEqual(normalizeCourses(fixture.courses));
    }
  });

  it('completes an existing fixture recipe without courses', async () => {
    const fixture = FIXTURE_RECIPES[0];
    const expectedCourses = normalizeCourses(fixture.courses);
    const expectedTags = deriveStyleTags(fixture.tags, fixture.ingredients);
    try {
      // Si azzera solo `courses`: `tags` resta com'è nel DB e il seed lo allinea da sé.
      await db.update(recipes).set({ courses: [] }).where(eq(recipes.id, fixture.id));

      const report = await seedDatabase();

      expect(report.recipesClassified).toBeGreaterThanOrEqual(1);
      const dbRecipe = await getRecipeById(fixture.id);
      expect(dbRecipe!.courses).toEqual(expectedCourses);
      expect(new Set(dbRecipe!.tags)).toEqual(new Set(expectedTags));
    } finally {
      await db.update(recipes).set({ courses: expectedCourses }).where(eq(recipes.id, fixture.id));
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
    // Writes made outside the transaction (e.g. a regression that calls seedDatabase(), which
    // writes on the global db) are invisible to a repeatable-read snapshot, so the check is
    // twofold: the fixture recipes (fixed ids, untouched by other test files) are counted on
    // the global db before and after, and the recipe repository must not be reached at all.
    const countFixtureRecipes = async (): Promise<number> => {
      const [{ value }] = await db
        .select({ value: count() })
        .from(recipes)
        .where(inArray(recipes.id, FIXTURE_RECIPES.map((r) => r.id)));
      return value;
    };
    const getRecipeSpy = vi.spyOn(recipeRepo, 'getRecipeById');
    const insertRecipeSpy = vi.spyOn(recipeRepo, 'insertRecipe');
    try {
      const fixturesBefore = await countFixtureRecipes();

      await seedIngredientAliases();
      const second = await seedIngredientAliases();

      expect(second).toBe(0);
      expect(await countFixtureRecipes()).toBe(fixturesBefore);
      expect(getRecipeSpy).not.toHaveBeenCalled();
      expect(insertRecipeSpy).not.toHaveBeenCalled();
    } finally {
      getRecipeSpy.mockRestore();
      insertRecipeSpy.mockRestore();
    }
  });

  it('seedIngredientAliases corrects an alias whose canonical name changed', async () => {
    // In una transazione annullata alla fine: la riga sbagliata non è mai visibile agli altri test.
    const target = FIXTURE_INGREDIENT_ALIASES[0];
    class Rollback extends Error {}
    let written: number | undefined;
    let canonicalAfter: string | undefined;

    await expect(
      db.transaction(async (tx) => {
        await seedIngredientAliases(tx);
        await tx
          .update(ingredient_aliases)
          .set({ canonical_name: 'nome canonico sbagliato di prova' })
          .where(eq(ingredient_aliases.alias, target.alias));

        written = await seedIngredientAliases(tx);
        const row = await tx.query.ingredient_aliases.findFirst({
          where: eq(ingredient_aliases.alias, target.alias),
        });
        canonicalAfter = row?.canonical_name;
        throw new Rollback();
      })
    ).rejects.toBeInstanceOf(Rollback);

    expect(written).toBe(1);
    expect(canonicalAfter).toBe(target.canonical_name);
  });
});
