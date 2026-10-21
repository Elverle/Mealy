// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, recipes } from '@/lib/db';
import {
  insertRecipe,
  listUnclassifiedRecipes,
  setRecipeClassification,
  type InsertRecipeInput,
} from '@/lib/db/repositories/recipe-repo';
import {
  isDbAvailable,
  assertDbMigrated,
  createTestHousehold,
  deleteTestHousehold,
} from '@/tests/helpers/db';

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

describe.skipIf(!dbUp)('recipe classification repository', () => {
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

  async function insertWithCourses(
    householdId: string,
    title: string,
    overrides: Partial<InsertRecipeInput> = {}
  ): Promise<string> {
    const suffix = crypto.randomUUID();
    const recipe = await insertRecipe(
      {
        household_id: householdId,
        title,
        slug: `${title.toLowerCase().replace(/\s+/g, '-')}-${suffix}`,
        steps: ['Passo unico.'],
        meal_types: ['pranzo'],
        courses: [],
        servings_base: 2,
        prep_minutes: 20,
        source: 'manual',
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

  describe('listUnclassifiedRecipes', () => {
    it('returns only the household recipes without courses, with their ingredients', async () => {
      const h = await newHousehold();
      const other = await newHousehold();
      const unclassified = await insertWithCourses(h, 'Pasta al pomodoro');
      await insertWithCourses(h, 'Pasta classificata', { courses: ['primo'] });
      await insertWithCourses(other, 'Ricetta di un altro household');

      const result = await listUnclassifiedRecipes(db, h);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: unclassified,
        title: 'Pasta al pomodoro',
        description: '',
        meal_types: ['pranzo'],
        tags: [],
        ingredients: expect.any(Array),
      });
      expect(result[0].ingredients).toHaveLength(2);
      expect(result[0].ingredients).toEqual(
        expect.arrayContaining([
          { canonical_name: 'farina', unit: 'g' },
          { canonical_name: 'sale', unit: 'qb' },
        ])
      );
    });

    it('lists the oldest recipe first', async () => {
      const h = await newHousehold();
      await insertWithCourses(h, 'Ricetta recente', { created_at: new Date('2026-03-02T10:00:00Z') });
      await insertWithCourses(h, 'Ricetta vecchia', { created_at: new Date('2026-02-01T10:00:00Z') });

      const titles = (await listUnclassifiedRecipes(db, h)).map((r) => r.title);

      expect(titles).toEqual(['Ricetta vecchia', 'Ricetta recente']);
    });
  });

  describe('setRecipeClassification', () => {
    it('writes courses and tags once, and then leaves the recipe alone', async () => {
      const h = await newHousehold();
      const id = await insertWithCourses(h, 'Frittata');

      const first = await setRecipeClassification(db, id, ['secondo', 'contorno'], ['veloce']);
      expect(first).toBe(true);
      expect(await readClassification(id)).toEqual({
        courses: ['secondo', 'contorno'],
        tags: ['veloce'],
      });

      const second = await setRecipeClassification(db, id, ['primo'], ['comfort-food']);
      expect(second).toBe(false);
      expect(await readClassification(id)).toEqual({
        courses: ['secondo', 'contorno'],
        tags: ['veloce'],
      });
    });

    it('does not touch a recipe that already has courses', async () => {
      const h = await newHousehold();
      const id = await insertWithCourses(h, 'Pasta classificata', { courses: ['primo'] });

      const written = await setRecipeClassification(db, id, ['secondo'], ['veloce']);

      expect(written).toBe(false);
      expect(await readClassification(id)).toEqual({ courses: ['primo'], tags: [] });
    });

    it('removes the recipe from listUnclassifiedRecipes once classified', async () => {
      const h = await newHousehold();
      const id = await insertWithCourses(h, 'Zuppa');

      await setRecipeClassification(db, id, ['primo'], []);

      expect(await listUnclassifiedRecipes(db, h)).toEqual([]);
    });
  });
});
