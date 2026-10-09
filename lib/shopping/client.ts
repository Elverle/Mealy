// Funzioni client per le API della lista della spesa. Importabile dai componenti "use client".
// In caso di errore lanciano ApiRequestError (lib/http/client.ts).

import {
  DeleteShoppingItemResultSchema,
  PlanShoppingListViewSchema,
  ShoppingItemResultSchema,
  type PlanShoppingListView,
  type ShoppingItemView,
} from '@/lib/domain/types';
import { requestJson } from '@/lib/http/client';

/** Limite di tempo delle richieste lanciate da un gesto o da una rilettura (le spunte hanno quello della coda). */
export const SHOPPING_REQUEST_TIMEOUT_MS = 10_000;

/** Interrompe la richiesta allo scadere del limite: `requestJson` la riporta come `network_error`. */
async function withTimeLimit<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHOPPING_REQUEST_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function listPath(planId: string): string {
  return `/api/plans/${encodeURIComponent(planId)}/shopping-list`;
}

function itemPath(itemId: string): string {
  return `/api/shopping-items/${encodeURIComponent(itemId)}`;
}

/** GET /api/plans/{planId}/shopping-list */
export function fetchPlanShoppingList(planId: string): Promise<PlanShoppingListView> {
  return withTimeLimit((signal) =>
    requestJson(listPath(planId), { method: 'GET', signal }, PlanShoppingListViewSchema)
  );
}

/** POST /api/plans/{planId}/shopping-list — crea la lista o la aggiorna dal piano. */
export function requestBuildShoppingList(planId: string): Promise<PlanShoppingListView> {
  return withTimeLimit((signal) =>
    requestJson(listPath(planId), { method: 'POST', signal }, PlanShoppingListViewSchema)
  );
}

/**
 * PATCH /api/shopping-items/{itemId} — restituisce l'articolo salvato.
 * `signal` interrompe la richiesta (la coda lo usa per il limite di tempo).
 */
export async function patchShoppingItem(
  itemId: string,
  checked: boolean,
  signal?: AbortSignal
): Promise<ShoppingItemView> {
  const result = await requestJson(
    itemPath(itemId),
    { method: 'PATCH', body: JSON.stringify({ checked }), signal },
    ShoppingItemResultSchema
  );
  return result.item;
}

/** POST /api/plans/{planId}/shopping-list/items — restituisce l'articolo (nuovo o già presente). */
export async function postShoppingItem(planId: string, name: string): Promise<ShoppingItemView> {
  const result = await withTimeLimit((signal) =>
    requestJson(
      `${listPath(planId)}/items`,
      { method: 'POST', body: JSON.stringify({ name }), signal },
      ShoppingItemResultSchema
    )
  );
  return result.item;
}

/** DELETE /api/shopping-items/{itemId} */
export async function deleteShoppingItem(itemId: string): Promise<void> {
  await withTimeLimit((signal) =>
    requestJson(itemPath(itemId), { method: 'DELETE', signal }, DeleteShoppingItemResultSchema)
  );
}
