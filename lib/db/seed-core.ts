import { sql } from 'drizzle-orm';
import { db, type DbExecutor, ingredient_aliases } from '@/lib/db';
import { getHouseholdById, ensureDefaultHousehold } from '@/lib/db/repositories/household-repo';
import {
  insertRecipe,
  getRecipeById,
  getRecipeBySlug,
  setRecipeClassification,
} from '@/lib/db/repositories/recipe-repo';
import { deriveStyleTags, normalizeCourses } from '@/lib/domain/courses';
import { DEFAULT_HOUSEHOLD_ID } from '@/lib/domain/types';
import { FIXTURE_RECIPES, FIXTURE_INGREDIENT_ALIASES, FIXTURE_CREATED_AT } from '@/fixtures';

export interface SeedReport {
  household: 'created' | 'existing';
  recipesInserted: number;
  recipesSkipped: number;
  /** Ricette d'esempio già presenti completate con portate ed etichette (v. `setRecipeClassification`). */
  recipesClassified: number;
  /** Alias inseriti o corretti (v. `seedIngredientAliases`). */
  aliasesInserted: number;
}

/**
 * Allinea `ingredient_aliases` alle fixture: inserisce gli alias che mancano e corregge quelli
 * il cui nome canonico è cambiato. Non cancella gli alias tolti dal file. Idempotente; restituisce
 * quante righe ha inserito o corretto (0 se la tabella era già allineata).
 */
export async function seedIngredientAliases(executor: DbExecutor = db): Promise<number> {
  const written = await executor
    .insert(ingredient_aliases)
    .values(FIXTURE_INGREDIENT_ALIASES)
    .onConflictDoUpdate({
      target: ingredient_aliases.alias,
      set: { canonical_name: sql`excluded.canonical_name` },
      setWhere: sql`${ingredient_aliases.canonical_name} is distinct from excluded.canonical_name`,
    })
    .returning({ alias: ingredient_aliases.alias });
  return written.length;
}

export async function seedDatabase(): Promise<SeedReport> {
  const existingHousehold = await getHouseholdById(DEFAULT_HOUSEHOLD_ID);
  const householdStatus: 'created' | 'existing' = existingHousehold ? 'existing' : 'created';
  await ensureDefaultHousehold();

  let recipesInserted = 0;
  let recipesSkipped = 0;
  let recipesClassified = 0;

  for (const r of FIXTURE_RECIPES) {
    const courses = normalizeCourses(r.courses);
    const tags = deriveStyleTags(r.tags, r.ingredients);
    const existingById = await getRecipeById(r.id);
    const existingBySlug = await getRecipeBySlug(r.slug);
    if (existingById) {
      recipesSkipped++;
      // Ricetta salvata prima delle portate: la completiamo, il resto della ricetta non si tocca.
      if (existingById.courses.length === 0) {
        const written = await setRecipeClassification(db, r.id, courses, tags);
        if (written) recipesClassified++;
      }
      continue;
    }
    if (existingBySlug) {
      recipesSkipped++;
      continue;
    }

    await insertRecipe(
      {
        id: r.id,
        household_id: DEFAULT_HOUSEHOLD_ID,
        title: r.title,
        slug: r.slug,
        description: r.description,
        steps: r.steps,
        meal_types: r.meal_types,
        courses,
        tags,
        diet_flags: r.diet_flags,
        appliances_required: r.appliances_required,
        servings_base: r.servings_base,
        prep_minutes: r.prep_minutes,
        kcal_est: r.kcal_est,
        macros_est: null,
        source: 'manual',
        created_at: FIXTURE_CREATED_AT,
      },
      r.ingredients.map(({ canonical_name, display_name, qty, unit, category, note }) => ({
        canonical_name,
        display_name,
        qty,
        unit,
        category,
        note,
      }))
    );
    recipesInserted++;
  }

  const aliasesInserted = await seedIngredientAliases(db);

  return {
    household: householdStatus,
    recipesInserted,
    recipesSkipped,
    recipesClassified,
    aliasesInserted,
  };
}
