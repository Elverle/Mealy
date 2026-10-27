// Solo lato server: scrittura in libreria di una ricetta generata.

import {
  type DbExecutor,
  type RecipeWithDetails,
  insertRecipeWith,
  slugExists,
} from '@/lib/db/repositories/recipe-repo';
import { type GeneratedRecipe, type RecipeSource } from '@/lib/domain/types';
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

export interface InsertGeneratedRecipeOptions {
  /** Default 'llm'. Le ricette del pacchetto (Feature 10) entrano con 'manual'. */
  source?: RecipeSource;
  /** Default adesso. Le ricette del pacchetto usano una data fissa, per l'ordine in Libreria. */
  createdAt?: Date;
}

/**
 * Inserisce una ricetta generata nella libreria dell'household, con slug univoco, origine
 * 'llm' e la riga di preferenze di default. L'origine è `'llm'` salvo `options.source`; la data
 * di creazione è adesso salvo `options.createdAt`. Va chiamata dentro una transazione, dopo
 * `acquireRecipeGenerationLock`: lo slug si calcola leggendo quelli esistenti.
 * Applica le regole derivate (`deriveStyleTags`): è il punto unico di scrittura per
 * generazione, proposta salvata e pacchetto della Feature 10.
 */
export async function insertGeneratedRecipe(
  executor: DbExecutor,
  householdId: string,
  recipe: GeneratedRecipe,
  options: InsertGeneratedRecipeOptions = {}
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
      tags: deriveStyleTags(recipe.tags, recipe.ingredients),
      diet_flags: recipe.diet_flags,
      appliances_required: recipe.appliances_required,
      servings_base: recipe.servings_base,
      prep_minutes: recipe.prep_minutes,
      kcal_est: recipe.kcal_est,
      macros_est: null,
      source: options.source ?? 'llm',
      created_at: options.createdAt,
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
