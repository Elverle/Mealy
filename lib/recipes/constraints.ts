import {
  type Household,
  type MealType,
  type RecipeConstraints,
  type ConstraintOverrides,
  type GeneratedRecipe,
  RecipeConstraintsSchema,
} from '@/lib/domain/types';
import { expandDietFlags, normalizeCanonicalName } from '@/lib/domain/recipe-text';

/**
 * Builds recipe constraints for generation from household profile and optional overrides.
 */
export function buildConstraints(
  household: Household,
  mealType: MealType | null,
  overrides?: ConstraintOverrides
): RecipeConstraints {
  return RecipeConstraintsSchema.parse({
    persons: overrides?.persons ?? household.persons,
    meal_type: mealType,
    diet_tags: overrides?.diet_tags ?? household.diet_tags,
    meal_style_tags: overrides?.meal_style_tags ?? household.meal_style_tags,
    appliances: overrides?.appliances ?? household.appliances,
    ingredient_likes: [], // F5 (S2.3): popolare da ingredient_prefs
    ingredient_dislikes: [], // F5 (S2.3): popolare da ingredient_prefs
  });
}

/**
 * Checks a generated recipe against given constraints and returns an array of violation descriptions.
 * An empty array indicates the recipe meets all constraints.
 * Violations are returned in order: meal_type, diet_tags, appliances, ingredient_dislikes.
 */
export function findConstraintViolations(
  recipe: GeneratedRecipe,
  constraints: RecipeConstraints
): string[] {
  const violations: string[] = [];

  // 1. pasto mancante
  if (constraints.meal_type !== null && !recipe.meal_types.includes(constraints.meal_type)) {
    violations.push(`pasto "${constraints.meal_type}" mancante`);
  }

  // 2. dieta non rispettata
  const recipeDiets = new Set(expandDietFlags(recipe.diet_flags));
  for (const diet of constraints.diet_tags) {
    if (!recipeDiets.has(diet)) {
      violations.push(`dieta "${diet}" non rispettata`);
    }
  }

  // 3. elettrodomestico non disponibile
  const availableAppliances = new Set(constraints.appliances);
  for (const appliance of recipe.appliances_required) {
    if (!availableAppliances.has(appliance)) {
      violations.push(`richiede "${appliance}" non disponibile`);
    }
  }

  // 4. ingrediente escluso
  const normalizedDislikes = new Set(
    constraints.ingredient_dislikes.map(normalizeCanonicalName)
  );
  for (const ing of recipe.ingredients) {
    if (normalizedDislikes.has(normalizeCanonicalName(ing.canonical_name))) {
      violations.push(`contiene "${ing.canonical_name}" (ingrediente escluso)`);
    }
  }

  return violations;
}
