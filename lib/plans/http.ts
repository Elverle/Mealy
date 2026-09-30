// Solo lato server: gestione comune degli errori delle rotte /api/plans.

import { errorResponse, internalErrorResponse, llmErrorResponse } from '@/lib/http/responses';
import { PLAN_ERROR_HTTP, isPlanError } from './errors';

/**
 * Traduce un errore in risposta HTTP. Gli errori di dominio (`PlanError`) non si
 * loggano; tutto il resto sì, e il corpo non espone mai stack trace o messaggi interni.
 */
export function handlePlanRouteError(err: unknown, tag: string): Response {
  if (isPlanError(err)) {
    const { status, message } = PLAN_ERROR_HTTP[err.code];
    return errorResponse(status, err.code, message);
  }
  console.error(tag, err);
  return llmErrorResponse(err) ?? internalErrorResponse();
}
