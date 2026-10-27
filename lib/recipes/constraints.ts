import {
  type Course,
  type Household,
  type MealType,
  type RecipeConstraints,
  type ConstraintOverrides,
  type GeneratedRecipe,
  RecipeConstraintsSchema,
} from '@/lib/domain/types';
import { coursesAllowed } from '@/lib/domain/courses';
import type { IngredientPreferenceSets } from '@/lib/domain/planner';
import { expandDietFlags, normalizeCanonicalName } from '@/lib/domain/recipe-text';

/** Massimo di ingredienti graditi riportati nel prompt (gli scarti vanno sempre tutti). */
export const PROMPT_INGREDIENT_LIKES_MAX = 30;

const sortItalian = (names: Iterable<string>): string[] =>
  [...names].sort((a, b) => a.localeCompare(b, 'it'));

/**
 * Builds recipe constraints for generation from household profile and optional overrides.
 * Le preferenze ingredienti (se presenti) popolano `ingredient_likes` (primi
 * PROMPT_INGREDIENT_LIKES_MAX in ordine alfabetico) e `ingredient_dislikes` (tutti).
 * `courses`: portate ammesse (null = qualsiasi).
 */
export function buildConstraints(
  household: Household,
  mealType: MealType | null,
  overrides: ConstraintOverrides | undefined,
  ingredientPrefs: IngredientPreferenceSets | undefined,
  courses: readonly Course[] | null
): RecipeConstraints {
  return RecipeConstraintsSchema.parse({
    persons: overrides?.persons ?? household.persons,
    meal_type: mealType,
    courses: courses === null ? null : [...courses],
    diet_tags: overrides?.diet_tags ?? household.diet_tags,
    meal_style_tags: overrides?.meal_style_tags ?? household.meal_style_tags,
    appliances: overrides?.appliances ?? household.appliances,
    ingredient_likes: sortItalian(ingredientPrefs?.likes ?? []).slice(
      0,
      PROMPT_INGREDIENT_LIKES_MAX
    ),
    ingredient_dislikes: sortItalian(ingredientPrefs?.dislikes ?? []),
  });
}

/**
 * Checks a generated recipe against given constraints and returns an array of violation descriptions.
 * An empty array indicates the recipe meets all constraints.
 * Violations are returned in order: meal_type, courses, diet_tags, appliances, ingredient_dislikes.
 *
 * Stesse regole di `exclusionReason` in `lib/domain/planner.ts` (applicate alla libreria):
 * se cambi una, controlla l'altra. La portata passa da `coursesAllowed` in entrambe.
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

  // 2. portata non ammessa
  if (!coursesAllowed(recipe.courses, constraints.courses)) {
    violations.push('portata non adatta al pasto');
  }

  // 3. dieta non rispettata
  const recipeDiets = new Set(expandDietFlags(recipe.diet_flags));
  for (const diet of constraints.diet_tags) {
    if (!recipeDiets.has(diet)) {
      violations.push(`dieta "${diet}" non rispettata`);
    }
  }

  // 4. elettrodomestico non disponibile
  const availableAppliances = new Set(constraints.appliances);
  for (const appliance of recipe.appliances_required) {
    if (!availableAppliances.has(appliance)) {
      violations.push(`richiede "${appliance}" non disponibile`);
    }
  }

  // 5. ingrediente escluso
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
