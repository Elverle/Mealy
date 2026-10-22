import { db } from '@/lib/db';
import { loadHousehold } from '@/lib/db/repositories/household-repo';
import {
  type RecipeWithDetails,
  listRecipeTitles,
  findSimilarRecipeTitle,
  acquireRecipeGenerationLock,
} from '@/lib/db/repositories/recipe-repo';
import {
  type ConstraintOverrides,
  type GenerationSkip,
  type MealType,
  MAIN_COURSE_VALUES,
} from '@/lib/domain/types';
import { normalizeTitle } from '@/lib/domain/recipe-text';
import { generateRecipes, type GenerateRecipesOptions } from '@/lib/llm';
import { loadIngredientPreferences } from '@/lib/prefs/ingredient-prefs';
import { buildConstraints, findConstraintViolations } from './constraints';
import { insertGeneratedRecipe } from './store';

export const EXCLUDED_TITLES_IN_PROMPT = 150;

export interface GenerateAndStoreInput {
  householdId?: string;
  count: number;
  mealType: MealType | null;
  overrides?: ConstraintOverrides;
}

export interface GenerateAndStoreResult {
  requested: number;
  created: RecipeWithDetails[];
  skipped: GenerationSkip[];
}

export interface GenerateAndStoreDeps {
  model?: GenerateRecipesOptions['model'];
  generate?: typeof generateRecipes;
}

/**
 * Genera e memorizza ricette nella libreria dell'household.
 *
 * NOTA ARCHITETTURALE:
 * Apre una propria transazione con advisory lock ed esegue la chiamata LLM fuori
 * da qualsiasi transazione: non va invocata dentro una transazione del chiamante
 * (F4 deve chiamarla prima di aprire la transazione del piano).
 */
export async function generateAndStoreRecipes(
  input: GenerateAndStoreInput,
  deps?: GenerateAndStoreDeps
): Promise<GenerateAndStoreResult> {
  const household = await loadHousehold(input.householdId);

  const ingredientPrefs = await loadIngredientPreferences(household.id);

  // Piano, swap e /api/recipes/generate: solo ricette che fanno da pasto.
  const constraints = buildConstraints(
    household,
    input.mealType,
    input.overrides ?? {},
    ingredientPrefs,
    MAIN_COURSE_VALUES
  );

  const excludeTitles = await listRecipeTitles(db, household.id, {
    mealType: input.mealType ?? undefined,
    limit: EXCLUDED_TITLES_IN_PROMPT,
  });

  const generateFn = deps?.generate ?? generateRecipes;
  const generated = await generateFn(constraints, input.count, excludeTitles, {
    model: deps?.model,
  });

  const created: RecipeWithDetails[] = [];
  const skipped: GenerationSkip[] = [];

  await db.transaction(async (tx) => {
    await acquireRecipeGenerationLock(tx);
    // Riletti nella transazione: un "non mi piace" salvato durante la chiamata LLM vale per il controllo.
    const currentConstraints = {
      ...constraints,
      ingredient_dislikes: [...(await loadIngredientPreferences(household.id, tx)).dislikes],
    };
    const existingTitles = await listRecipeTitles(tx, household.id);
    const known = new Set(existingTitles.map(normalizeTitle));

    for (const r of generated) {
      const violations = findConstraintViolations(r, currentConstraints);
      if (violations.length > 0) {
        skipped.push({
          title: r.title,
          reason: 'constraint_violation',
          detail: violations.join('; '),
        });
        continue;
      }

      const norm = normalizeTitle(r.title);
      if (known.has(norm)) {
        skipped.push({
          title: r.title,
          reason: 'duplicate',
          detail: 'titolo già presente in libreria',
        });
        continue;
      }

      const similar = await findSimilarRecipeTitle(tx, household.id, r.title);
      if (similar !== null) {
        skipped.push({
          title: r.title,
          reason: 'duplicate',
          detail: `simile a "${similar}"`,
        });
        continue;
      }

      const inserted = await insertGeneratedRecipe(tx, household.id, r);

      created.push(inserted);
      known.add(norm);
    }
  });

  return {
    requested: input.count,
    created,
    skipped,
  };
}
