import rawRecipes from './recipes.json';
import rawAliases from './ingredient-aliases.json';
import {
  FixtureFileSchema,
  IngredientAliasesFileSchema,
  RecipeSchema,
  type FixtureRecipe,
  type IngredientAlias,
  type Recipe,
  DEFAULT_HOUSEHOLD_ID,
} from '@/lib/domain/types';

export const FIXTURE_RECIPES: FixtureRecipe[] = FixtureFileSchema.parse(rawRecipes).recipes;
export const FIXTURE_INGREDIENT_ALIASES: IngredientAlias[] =
  IngredientAliasesFileSchema.parse(rawAliases).aliases;
export const FIXTURE_CREATED_AT: Date = new Date('2026-01-01T00:00:00Z');

export function fixtureRecipesAsDomain(householdId: string = DEFAULT_HOUSEHOLD_ID): Recipe[] {
  return FIXTURE_RECIPES.map((r) =>
    RecipeSchema.parse({
      ...r,
      household_id: householdId,
      source: 'manual',
      macros_est: null,
      created_at: FIXTURE_CREATED_AT,
      ingredients: r.ingredients.map((ing) => ({
        ...ing,
        recipe_id: r.id,
      })),
      prefs: null,
    })
  );
}
