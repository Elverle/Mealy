import { eq } from 'drizzle-orm';
import { db } from '../index';
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
  unit: Unit | string;
  category: Category | string;
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

function formatRecipe(row: Record<string, unknown>): RecipeWithDetails {
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
 * Insert a recipe with its ingredients and default preferences within a transaction.
 */
export async function insertRecipe(
  recipeData: InsertRecipeInput,
  ingredientsData: InsertIngredientInput[] = [],
  prefData?: InsertRecipePrefInput
): Promise<RecipeWithDetails> {
  return await db.transaction(async (tx) => {
    const recipeId = recipeData.id ?? crypto.randomUUID();

    const [insertedRecipe] = await tx
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
      insertedIngredients = await tx
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

    const [insertedPref] = await tx
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

    return formatRecipe({
      ...insertedRecipe,
      ingredients: insertedIngredients,
      prefs: insertedPref,
    });
  });
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
  return formatRecipe(result);
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
  return formatRecipe(result);
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
 * List all recipes with ingredients and preferences, optionally filtered by household_id.
 */
export async function listRecipes(filter?: {
  household_id?: string;
}): Promise<RecipeWithDetails[]> {
  const results = await db.query.recipes.findMany({
    where: filter?.household_id ? eq(recipes.household_id, filter.household_id) : undefined,
    with: {
      ingredients: true,
      prefs: true,
    },
    orderBy: (rec, { desc }) => [desc(rec.created_at)],
  });

  return results.map(formatRecipe);
}
