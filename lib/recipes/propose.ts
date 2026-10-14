// Solo lato server: proposta di una ricetta su richiesta e salvataggio della proposta accettata.

import { db } from '@/lib/db';
import { getHouseholdById, loadHousehold } from '@/lib/db/repositories/household-repo';
import {
  type RecipeWithDetails,
  acquireRecipeGenerationLock,
  listRecipeTitles,
  listRecipeTitleRefs,
} from '@/lib/db/repositories/recipe-repo';
import {
  type GeneratedRecipe,
  type Household,
  type MealType,
  type RecipeConstraints,
  type RecipeProposal,
} from '@/lib/domain/types';
import { normalizeGeneratedRecipe, normalizeTitle } from '@/lib/domain/recipe-text';
import { generateRecipeFromRequest, type GenerateRecipesOptions } from '@/lib/llm';
import { buildConstraints, findConstraintViolations } from './constraints';
import { RecipeError } from './errors';
import { insertGeneratedRecipe } from './store';

export interface ProposeRecipeInput {
  /** Default: singleton. */
  householdId?: string;
  request: string;
  mealType: MealType | null;
  excludeTitles: readonly string[];
}

export interface ProposeRecipeDeps {
  model?: GenerateRecipesOptions['model'];
  /** Default: `generateRecipeFromRequest`. */
  generate?: typeof generateRecipeFromRequest;
  /** Annulla la chiamata al modello (chiusura della sheet lato client). */
  abortSignal?: AbortSignal;
}

export interface SaveProposedRecipeInput {
  /** Default: singleton. */
  householdId?: string;
  recipe: GeneratedRecipe;
}

/**
 * Vincoli di una richiesta esplicita: persone, tipo di pasto, diete ed elettrodomestici.
 * Niente stile preferito né preferenze sugli ingredienti: guida il testo della richiesta.
 */
function requestConstraints(household: Household, mealType: MealType | null): RecipeConstraints {
  return buildConstraints(household, mealType, { meal_style_tags: [] });
}

/**
 * Propone una ricetta per una richiesta libera. Non scrive nulla e non apre transazioni: la
 * ricetta entra in libreria solo con `saveProposedRecipe`. Una proposta che viola i vincoli
 * fa fallire con `proposal_unsuitable` (nessun secondo tentativo automatico).
 */
export async function proposeRecipe(
  input: ProposeRecipeInput,
  deps?: ProposeRecipeDeps
): Promise<RecipeProposal> {
  const household = await loadHousehold(input.householdId);
  const constraints = requestConstraints(household, input.mealType);

  const generate = deps?.generate ?? generateRecipeFromRequest;
  const recipe = await generate(constraints, input.request, input.excludeTitles, {
    model: deps?.model,
    abortSignal: deps?.abortSignal,
  });

  const violations = findConstraintViolations(recipe, constraints);
  if (violations.length > 0) {
    console.warn('[recipes/propose] proposal_unsuitable', { title: recipe.title, violations });
    throw new RecipeError('proposal_unsuitable');
  }

  const key = normalizeTitle(recipe.title);
  const match = (await listRecipeTitleRefs(db, household.id)).find(
    (ref) => normalizeTitle(ref.title) === key
  );

  return {
    recipe,
    duplicate_of: match ? { id: match.id, title: match.title } : null,
  };
}

/**
 * Salva in libreria una proposta accettata, dopo averla ricontrollata con i vincoli
 * correnti (diete ed elettrodomestici: la richiesta ha già scelto il pasto). Una ricetta con
 * lo stesso titolo normalizzato fa fallire con `recipe_duplicate`; la somiglianza non conta.
 */
export async function saveProposedRecipe(
  input: SaveProposedRecipeInput
): Promise<RecipeWithDetails> {
  const household = await loadHousehold(input.householdId);
  const recipe = normalizeGeneratedRecipe(input.recipe);

  return db.transaction(async (tx) => {
    await acquireRecipeGenerationLock(tx);

    // Riletto nella transazione: vincoli cambiati durante la richiesta valgono per il controllo.
    const current = await getHouseholdById(household.id, tx);
    if (!current) {
      throw new Error(`Household ${household.id} non trovato`);
    }

    const violations = findConstraintViolations(recipe, requestConstraints(current, null));
    if (violations.length > 0) {
      console.warn('[recipes/save] recipe_unsuitable', { title: recipe.title, violations });
      throw new RecipeError('recipe_unsuitable');
    }

    const key = normalizeTitle(recipe.title);
    const titles = await listRecipeTitles(tx, household.id);
    if (titles.some((title) => normalizeTitle(title) === key)) {
      throw new RecipeError('recipe_duplicate');
    }

    return insertGeneratedRecipe(tx, household.id, recipe);
  });
}
