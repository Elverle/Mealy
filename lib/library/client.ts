// Funzioni client per le API della Libreria. Importabile dai componenti "use client":
// nessuna dipendenza dal DB. In caso di errore lanciano ApiRequestError (lib/http/client.ts).

import { RecipeDetailViewSchema, type RecipeDetailView } from '@/lib/domain/types';
import { requestJson } from '@/lib/http/client';

/** GET /api/recipes/{recipeId} */
export function fetchRecipeDetail(recipeId: string): Promise<RecipeDetailView> {
  return requestJson(
    `/api/recipes/${encodeURIComponent(recipeId)}`,
    { method: 'GET' },
    RecipeDetailViewSchema
  );
}
