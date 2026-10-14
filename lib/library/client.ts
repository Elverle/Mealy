// Funzioni client per le API della Libreria. Importabile dai componenti "use client":
// nessuna dipendenza dal DB. In caso di errore lanciano ApiRequestError (lib/http/client.ts).

import {
  RecipeDetailViewSchema,
  RecipeProposalSchema,
  SaveRecipeResultSchema,
  type GeneratedRecipe,
  type MealType,
  type Recipe,
  type RecipeDetailView,
  type RecipeProposal,
} from '@/lib/domain/types';
import { requestJson } from '@/lib/http/client';

/** GET /api/recipes/{recipeId} */
export function fetchRecipeDetail(recipeId: string): Promise<RecipeDetailView> {
  return requestJson(
    `/api/recipes/${encodeURIComponent(recipeId)}`,
    { method: 'GET' },
    RecipeDetailViewSchema
  );
}

export interface RecipeProposalInput {
  request: string;
  /** Tipo di pasto imposto (dal Piano); null = lo decide il modello. */
  mealType: MealType | null;
  /** Titoli già proposti nella sequenza di «Un'altra». */
  excludeTitles: readonly string[];
}

/**
 * POST /api/recipes/propose — una proposta di ricetta, non salvata.
 * `signal` annulla la richiesta: in quel caso la promessa rigetta con `network_error`,
 * quindi chi annulla deve controllare `signal.aborted` e ignorare l'esito.
 */
export function requestRecipeProposal(
  input: RecipeProposalInput,
  signal?: AbortSignal
): Promise<RecipeProposal> {
  return requestJson(
    '/api/recipes/propose',
    {
      method: 'POST',
      body: JSON.stringify({
        request: input.request,
        meal_type: input.mealType,
        exclude_titles: input.excludeTitles,
      }),
      signal,
    },
    RecipeProposalSchema
  );
}

/** POST /api/recipes — salva in libreria una ricetta proposta e la restituisce completa. */
export async function requestSaveRecipe(recipe: GeneratedRecipe): Promise<Recipe> {
  const result = await requestJson(
    '/api/recipes',
    { method: 'POST', body: JSON.stringify({ recipe }) },
    SaveRecipeResultSchema
  );
  return result.recipe;
}
