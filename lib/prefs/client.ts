// Funzioni client per le API delle preferenze. Importabile dai componenti "use client".
// In caso di errore lanciano ApiRequestError (lib/http/client.ts).

import {
  RecipePrefResultSchema,
  SetIngredientPrefResultSchema,
  type IngredientPref,
  type RecipePref,
  type SetIngredientPrefResult,
  type UpdateRecipePrefRequest,
} from '@/lib/domain/types';
import { requestJson } from '@/lib/http/client';

/** PUT /api/recipes/{recipeId}/pref — restituisce le preferenze salvate. */
export async function putRecipePref(
  recipeId: string,
  patch: UpdateRecipePrefRequest
): Promise<RecipePref> {
  const result = await requestJson(
    `/api/recipes/${encodeURIComponent(recipeId)}/pref`,
    { method: 'PUT', body: JSON.stringify(patch) },
    RecipePrefResultSchema
  );
  return result.prefs;
}

/** PUT /api/ingredient-prefs/{canonicalName} — pref null rimuove il giudizio. */
export function putIngredientPref(
  canonicalName: string,
  pref: IngredientPref | null
): Promise<SetIngredientPrefResult> {
  return requestJson(
    `/api/ingredient-prefs/${encodeURIComponent(canonicalName)}`,
    { method: 'PUT', body: JSON.stringify({ pref }) },
    SetIngredientPrefResultSchema
  );
}
