import { db, type DbExecutor, ingredient_aliases } from '@/lib/db';
import { getHouseholdById, ensureDefaultHousehold } from '@/lib/db/repositories/household-repo';
import { insertRecipe, getRecipeById, getRecipeBySlug } from '@/lib/db/repositories/recipe-repo';
import { DEFAULT_HOUSEHOLD_ID } from '@/lib/domain/types';
import { FIXTURE_RECIPES, FIXTURE_INGREDIENT_ALIASES, FIXTURE_CREATED_AT } from '@/fixtures';

export interface SeedReport {
  household: 'created' | 'existing';
  recipesInserted: number;
  recipesSkipped: number;
  aliasesInserted: number;
}

/** Inserisce gli alias delle fixture che mancano (idempotente); restituisce quanti ne ha inseriti. */
export async function seedIngredientAliases(executor: DbExecutor = db): Promise<number> {
  const insertedAliases = await executor
    .insert(ingredient_aliases)
    .values(FIXTURE_INGREDIENT_ALIASES)
    .onConflictDoNothing()
    .returning({ alias: ingredient_aliases.alias });
  return insertedAliases.length;
}

export async function seedDatabase(): Promise<SeedReport> {
  const existingHousehold = await getHouseholdById(DEFAULT_HOUSEHOLD_ID);
  const householdStatus: 'created' | 'existing' = existingHousehold ? 'existing' : 'created';
  await ensureDefaultHousehold();

  let recipesInserted = 0;
  let recipesSkipped = 0;

  for (const r of FIXTURE_RECIPES) {
    const existingById = await getRecipeById(r.id);
    const existingBySlug = await getRecipeBySlug(r.slug);
    if (existingById || existingBySlug) {
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
        tags: r.tags,
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
    aliasesInserted,
  };
}
