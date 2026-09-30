import { and, arrayContains, desc, eq, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '../index';
import {
  recipe_ingredients,
  recipe_prefs,
  recipes,
} from '../schema';
import {
  Appliance,
  Category,
  DietFlag,
  Ingredient,
  IngredientSchema,
  MealStyleTag,
  MealType,
  Recipe,
  RecipePref,
  RecipePrefSchema,
  RecipeSchema,
  RecipeSource,
  Unit,
} from '@/lib/domain/types';

export type { DbExecutor } from '../index';

export const TITLE_SIMILARITY_THRESHOLD = 0.6;

export interface InsertRecipeInput {
  id?: string;
  household_id: string;
  title: string;
  slug: string;
  description?: string;
  steps: string[];
  meal_types: MealType[];
  tags?: MealStyleTag[];
  diet_flags?: DietFlag[];
  appliances_required?: Appliance[];
  servings_base: number;
  prep_minutes: number;
  kcal_est?: number | null;
  macros_est?: Record<string, unknown> | null;
  source?: RecipeSource;
  created_at?: Date;
}

export interface InsertIngredientInput {
  id?: string;
  canonical_name: string;
  display_name: string;
  qty?: number | string | null;
  unit: Unit;
  category: Category;
  note?: string | null;
}

export interface InsertRecipePrefInput {
  rating?: number | null;
  favorite?: boolean;
  blocked?: boolean;
  times_used?: number;
  last_used_at?: Date | null;
}

export type RecipeWithDetails = Omit<Recipe, 'ingredients' | 'prefs'> & {
  ingredients: Ingredient[];
  prefs: RecipePref | null;
};

/**
 * Converte una riga di `db.query.recipes` con `ingredients` e `prefs` in `RecipeWithDetails`.
 */
export function toRecipeWithDetails(row: Record<string, unknown>): RecipeWithDetails {
  const rowIngredients = Array.isArray(row.ingredients) ? row.ingredients : [];
  const ingredients: Ingredient[] = rowIngredients.map((ing) => {
    const item = typeof ing === 'object' && ing !== null ? (ing as Record<string, unknown>) : {};
    return IngredientSchema.parse({
      ...item,
      qty: item.qty != null ? Number(item.qty) : null,
    });
  });

  const prefs: RecipePref | null =
    typeof row.prefs === 'object' && row.prefs !== null
      ? RecipePrefSchema.parse(row.prefs)
      : null;

  const parsedRecipe = RecipeSchema.parse({
    ...row,
    ingredients,
    prefs,
  });

  return {
    ...parsedRecipe,
    ingredients,
    prefs,
  };
}

/**
 * Insert a recipe with its ingredients and preferences using the provided executor.
 */
export async function insertRecipeWith(
  executor: DbExecutor,
  recipeData: InsertRecipeInput,
  ingredientsData: InsertIngredientInput[] = [],
  prefData?: InsertRecipePrefInput
): Promise<RecipeWithDetails> {
  const recipeId = recipeData.id ?? crypto.randomUUID();

  const [insertedRecipe] = await executor
    .insert(recipes)
    .values({
      id: recipeId,
      household_id: recipeData.household_id,
      title: recipeData.title,
      slug: recipeData.slug,
      description: recipeData.description ?? '',
      steps: recipeData.steps,
      meal_types: recipeData.meal_types,
      tags: recipeData.tags ?? [],
      diet_flags: recipeData.diet_flags ?? [],
      appliances_required: recipeData.appliances_required ?? [],
      servings_base: recipeData.servings_base,
      prep_minutes: recipeData.prep_minutes,
      kcal_est: recipeData.kcal_est ?? null,
      macros_est: recipeData.macros_est ?? null,
      source: recipeData.source ?? 'manual',
      created_at: recipeData.created_at ?? new Date(),
    })
    .returning();

  let insertedIngredients: (typeof recipe_ingredients.$inferSelect)[] = [];
  if (ingredientsData.length > 0) {
    insertedIngredients = await executor
      .insert(recipe_ingredients)
      .values(
        ingredientsData.map((ing) => ({
          id: ing.id ?? crypto.randomUUID(),
          recipe_id: recipeId,
          canonical_name: ing.canonical_name,
          display_name: ing.display_name,
          qty: ing.qty != null ? String(ing.qty) : null,
          unit: ing.unit,
          category: ing.category,
          note: ing.note ?? null,
        }))
      )
      .returning();
  }

  const [insertedPref] = await executor
    .insert(recipe_prefs)
    .values({
      recipe_id: recipeId,
      rating: prefData?.rating ?? null,
      favorite: prefData?.favorite ?? false,
      blocked: prefData?.blocked ?? false,
      times_used: prefData?.times_used ?? 0,
      last_used_at: prefData?.last_used_at ?? null,
    })
    .returning();

  return toRecipeWithDetails({
    ...insertedRecipe,
    ingredients: insertedIngredients,
    prefs: insertedPref,
  });
}

/**
 * Insert a recipe with its ingredients and default preferences within a transaction.
 */
export async function insertRecipe(
  recipeData: InsertRecipeInput,
  ingredientsData: InsertIngredientInput[] = [],
  prefData?: InsertRecipePrefInput
): Promise<RecipeWithDetails> {
  return await db.transaction((tx) =>
    insertRecipeWith(tx, recipeData, ingredientsData, prefData)
  );
}

/**
 * List recipe titles for a household, optionally filtered by mealType and limited.
 * Ordered by created_at desc.
 */
export async function listRecipeTitles(
  executor: DbExecutor,
  householdId: string,
  options?: { mealType?: MealType; limit?: number }
): Promise<string[]> {
  const conditions = [eq(recipes.household_id, householdId)];
  if (options?.mealType) {
    conditions.push(arrayContains(recipes.meal_types, [options.mealType]));
  }

  const baseQuery = executor
    .select({ title: recipes.title })
    .from(recipes)
    .where(and(...conditions))
    .orderBy(desc(recipes.created_at));

  const rows =
    options?.limit !== undefined
      ? await baseQuery.limit(options.limit)
      : await baseQuery;

  return rows.map((r) => r.title);
}

/**
 * Finds the most similar recipe title in the household using trigram similarity.
 * Returns null if no title exceeds the threshold.
 */
export async function findSimilarRecipeTitle(
  executor: DbExecutor,
  householdId: string,
  title: string,
  threshold: number = TITLE_SIMILARITY_THRESHOLD
): Promise<string | null> {
  const rows = await executor
    .select({ title: recipes.title })
    .from(recipes)
    .where(
      and(
        eq(recipes.household_id, householdId),
        sql`similarity(${recipes.title}, ${title}) > ${threshold}`
      )
    )
    .orderBy(sql`similarity(${recipes.title}, ${title}) desc`)
    .limit(1);

  return rows[0]?.title ?? null;
}

/**
 * Checks if a recipe slug already exists globally across any household.
 */
export async function slugExists(executor: DbExecutor, slug: string): Promise<boolean> {
  const rows = await executor
    .select({ id: recipes.id })
    .from(recipes)
    .where(eq(recipes.slug, slug))
    .limit(1);

  return rows.length > 0;
}

/**
 * Acquires a transaction-level advisory lock for recipe generation.
 *
 * NOTE: Must only be called within an active database transaction.
 * The lock is automatically released upon transaction commit or rollback.
 */
export async function acquireRecipeGenerationLock(executor: DbExecutor): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext('mealy:recipes:generate'))`);
}

/**
 * Get recipe by ID with ingredients and preferences. Returns null if not found.
 */
export async function getRecipeById(id: string): Promise<RecipeWithDetails | null> {
  const result = await db.query.recipes.findFirst({
    where: eq(recipes.id, id),
    with: {
      ingredients: true,
      prefs: true,
    },
  });

  if (!result) return null;
  return toRecipeWithDetails(result);
}

/**
 * Get recipe by slug with ingredients and preferences. Returns null if not found.
 */
export async function getRecipeBySlug(slug: string): Promise<RecipeWithDetails | null> {
  const result = await db.query.recipes.findFirst({
    where: eq(recipes.slug, slug),
    with: {
      ingredients: true,
      prefs: true,
    },
  });

  if (!result) return null;
  return toRecipeWithDetails(result);
}

/**
 * Delete a recipe by ID. Associated ingredients and preferences are deleted by ON DELETE CASCADE.
 */
export async function deleteRecipe(id: string): Promise<boolean> {
  const deleted = await db
    .delete(recipes)
    .where(eq(recipes.id, id))
    .returning({ id: recipes.id });

  return deleted.length > 0;
}

/**
 * List all recipes with ingredients and preferences using the provided executor
 * (db or transaction), optionally filtered by household_id.
 */
export async function listRecipesWith(
  executor: DbExecutor,
  filter?: { household_id?: string }
): Promise<RecipeWithDetails[]> {
  const results = await executor.query.recipes.findMany({
    where: filter?.household_id ? eq(recipes.household_id, filter.household_id) : undefined,
    with: {
      ingredients: true,
      prefs: true,
    },
    orderBy: (rec, { desc }) => [desc(rec.created_at)],
  });

  return results.map(toRecipeWithDetails);
}

/**
 * List all recipes with ingredients and preferences, optionally filtered by household_id.
 */
export async function listRecipes(filter?: {
  household_id?: string;
}): Promise<RecipeWithDetails[]> {
  return listRecipesWith(db, filter);
}
