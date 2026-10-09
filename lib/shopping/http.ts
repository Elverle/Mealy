// Solo lato server: gestione comune degli errori delle rotte della lista della spesa.

import { errorResponse, internalErrorResponse } from '@/lib/http/responses';
import { SHOPPING_ERROR_HTTP, isShoppingError } from './errors';

/** ShoppingError → risposta col suo status e codice, senza log; il resto si logga e diventa 500 senza dettagli. */
export function handleShoppingRouteError(err: unknown, tag: string): Response {
  if (isShoppingError(err)) {
    const { status, message } = SHOPPING_ERROR_HTTP[err.code];
    return errorResponse(status, err.code, message);
  }
  console.error(tag, err);
  return internalErrorResponse();
}
