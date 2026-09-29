// Funzioni client per le API dei piani. Importabile dai componenti "use client":
// nessuna dipendenza dal DB.

import {
  GeneratePlanResultSchema,
  PlanMutationResultSchema,
  PlanResultSchema,
  PlanScreenViewSchema,
  type GeneratePlanResult,
  type PlanMutationResult,
  type PlanResult,
  type PlanScreenView,
} from '@/lib/domain/types';
import { ApiRequestError, requestJson } from '@/lib/http/client';
import type { z } from 'zod';

/** Errore di ogni funzione di questo modulo (rete, non 2xx, risposta non valida). */
export class PlanRequestError extends ApiRequestError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message);
    this.name = 'PlanRequestError';
  }
}

async function request<T>(url: string, init: RequestInit, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
  try {
    return await requestJson(url, init, schema);
  } catch (err) {
    if (err instanceof ApiRequestError) {
      throw new PlanRequestError(err.status, err.code, err.message);
    }
    throw err;
  }
}

function planPath(planId: string): string {
  return `/api/plans/${encodeURIComponent(planId)}`;
}

/** GET /api/plans/current, opzionalmente su una settimana (`?settimana=YYYY-MM-DD`). */
export function fetchPlanScreen(week?: string): Promise<PlanScreenView> {
  const query = week ? `?settimana=${encodeURIComponent(week)}` : '';
  return request(`/api/plans/current${query}`, { method: 'GET' }, PlanScreenViewSchema);
}

/** POST /api/plans: genera (o rigenera) il piano della settimana obiettivo. */
export function requestGeneratePlan(): Promise<GeneratePlanResult> {
  return request('/api/plans', { method: 'POST', body: '{}' }, GeneratePlanResultSchema);
}

/** POST /api/plans/{planId}/confirm */
export function requestConfirmPlan(planId: string): Promise<PlanResult> {
  return request(`${planPath(planId)}/confirm`, { method: 'POST' }, PlanResultSchema);
}

/** PATCH /api/plans/{planId}/slots/{slotId}: blocca/sblocca lo slot. */
export function requestSlotLock(
  planId: string,
  slotId: string,
  locked: boolean
): Promise<PlanResult> {
  return request(
    `${planPath(planId)}/slots/${encodeURIComponent(slotId)}`,
    { method: 'PATCH', body: JSON.stringify({ locked }) },
    PlanResultSchema
  );
}

/** POST /api/plans/{planId}/slots/{slotId}/swap (la rotta arriva con WP5). */
export function requestSwapSlot(
  planId: string,
  slotId: string,
  excludeRecipeIds: string[]
): Promise<PlanMutationResult> {
  return request(
    `${planPath(planId)}/slots/${encodeURIComponent(slotId)}/swap`,
    { method: 'POST', body: JSON.stringify({ exclude_recipe_ids: excludeRecipeIds }) },
    PlanMutationResultSchema
  );
}

/** POST /api/plans/{planId}/repeat (la rotta arriva con WP5): copia il piano sulla settimana obiettivo. */
export function requestRepeatPlan(planId: string): Promise<GeneratePlanResult> {
  return request(`${planPath(planId)}/repeat`, { method: 'POST' }, GeneratePlanResultSchema);
}
