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

function listPath(planId: string): string {
  return `/api/plans/${encodeURIComponent(planId)}/shopping-list`;
}

function itemPath(itemId: string): string {
  return `/api/shopping-items/${encodeURIComponent(itemId)}`;
}

/** GET /api/plans/{planId}/shopping-list */
export function fetchPlanShoppingList(planId: string): Promise<PlanShoppingListView> {
  return requestJson(listPath(planId), { method: 'GET' }, PlanShoppingListViewSchema);
}

/** POST /api/plans/{planId}/shopping-list — crea la lista o la aggiorna dal piano. */
export function requestBuildShoppingList(planId: string): Promise<PlanShoppingListView> {
  return requestJson(listPath(planId), { method: 'POST' }, PlanShoppingListViewSchema);
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
  const result = await requestJson(
    `${listPath(planId)}/items`,
    { method: 'POST', body: JSON.stringify({ name }) },
    ShoppingItemResultSchema
  );
  return result.item;
}

/** DELETE /api/shopping-items/{itemId} */
export async function deleteShoppingItem(itemId: string): Promise<void> {
  await requestJson(itemPath(itemId), { method: 'DELETE' }, DeleteShoppingItemResultSchema);
}
