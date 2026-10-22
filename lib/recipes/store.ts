// Solo lato server: scrittura in libreria di una ricetta generata.

import {
  type DbExecutor,
  type RecipeWithDetails,
  insertRecipeWith,
  slugExists,
} from '@/lib/db/repositories/recipe-repo';
import { type GeneratedRecipe } from '@/lib/domain/types';
import { deriveStyleTags, normalizeCourses } from '@/lib/domain/courses';
import { slugify } from '@/lib/domain/recipe-text';

/**
 * Finds a unique slug by appending incremental numeric suffixes or random characters if collisions occur.
 */
async function uniqueSlug(executor: DbExecutor, baseSlug: string): Promise<string> {
  if (!(await slugExists(executor, baseSlug))) {
    return baseSlug;
  }
  for (let i = 2; i <= 99; i++) {
    const candidate = `${baseSlug}-${i}`;
    if (!(await slugExists(executor, candidate))) {
      return candidate;
    }
  }
  return `${baseSlug}-${crypto.randomUUID().slice(0, 6)}`;
}

/**
 * Inserisce una ricetta generata nella libreria dell'household, con slug univoco, origine
 * 'llm' e la riga di preferenze di default. Va chiamata dentro una transazione, dopo
 * `acquireRecipeGenerationLock`: lo slug si calcola leggendo quelli esistenti.
 * Applica le regole derivate (`deriveStyleTags`): è il punto unico di scrittura per
 * generazione, proposta salvata e pacchetto della Feature 10.
 */
export async function insertGeneratedRecipe(
  executor: DbExecutor,
  householdId: string,
  recipe: GeneratedRecipe
): Promise<RecipeWithDetails> {
  const slug = await uniqueSlug(executor, slugify(recipe.title));
  const courses = normalizeCourses(recipe.courses);

  return insertRecipeWith(
    executor,
    {
      household_id: householdId,
      title: recipe.title,
      slug,
      description: recipe.description,
      steps: recipe.steps,
      meal_types: recipe.meal_types,
      courses,
      tags: deriveStyleTags(recipe.tags, courses, recipe.ingredients),
      diet_flags: recipe.diet_flags,
      appliances_required: recipe.appliances_required,
      servings_base: recipe.servings_base,
      prep_minutes: recipe.prep_minutes,
      kcal_est: recipe.kcal_est,
      macros_est: null,
      source: 'llm',
    },
    recipe.ingredients.map(({ canonical_name, display_name, qty, unit, category, note }) => ({
      canonical_name,
      display_name,
      qty,
      unit,
      category,
      note,
    }))
  );
}
