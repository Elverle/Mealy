// Solo lato server: gestione comune degli errori delle rotte /api/recipes.

import { errorResponse, internalErrorResponse, llmErrorResponse } from '@/lib/http/responses';
import { RECIPE_ERROR_HTTP, isRecipeError } from './errors';

/**
 * Traduce un errore in risposta HTTP. I `RecipeError` non si loggano; tutto il resto sì,
 * e il corpo non espone mai stack trace o messaggi interni.
 */
export function handleRecipeRouteError(err: unknown, tag: string): Response {
  if (isRecipeError(err)) {
    const { status, message } = RECIPE_ERROR_HTTP[err.code];
    return errorResponse(status, err.code, message);
  }
  console.error(tag, err);
  return llmErrorResponse(err) ?? internalErrorResponse();
}
