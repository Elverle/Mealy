// Helper di trasporto condivisi dalle rotte API: busta d'errore `{ error: { code, message, details? } }`.
// Solo lato server (usato dai route handler).

import type { z } from 'zod';
import { isLlmError } from '@/lib/llm/errors';

export interface ErrorDetail {
  path: string;
  message: string;
}

const INVALID_REQUEST_MESSAGE = 'Richiesta non valida.';
const INTERNAL_ERROR_MESSAGE = 'Qualcosa è andato storto. Riprova.';
const LLM_FAILED_MESSAGE = 'La generazione non è andata a buon fine. Riprova.';
const LLM_NOT_CONFIGURED_MESSAGE = 'Generazione non disponibile: il modello non è configurato.';

const HTTP_BAD_REQUEST = 400;
const HTTP_INTERNAL_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const HTTP_GATEWAY_TIMEOUT = 504;

/** Risposta d'errore con la busta standard. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: ErrorDetail[]
): Response {
  return Response.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

/** 400 `invalid_request`; con `issues` aggiunge `details` (path + messaggio). */
export function invalidRequestResponse(issues?: z.ZodIssue[]): Response {
  return errorResponse(
    HTTP_BAD_REQUEST,
    'invalid_request',
    INVALID_REQUEST_MESSAGE,
    issues?.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
  );
}

/** 500 `internal_error`, senza dettagli interni. */
export function internalErrorResponse(): Response {
  return errorResponse(HTTP_INTERNAL_ERROR, 'internal_error', INTERNAL_ERROR_MESSAGE);
}

/** Risposta per un `LlmError` noto, oppure `null` se `err` non è un errore LLM. */
export function llmErrorResponse(err: unknown): Response | null {
  if (!isLlmError(err)) return null;
  switch (err.code) {
    case 'config':
      return errorResponse(HTTP_INTERNAL_ERROR, 'llm_not_configured', LLM_NOT_CONFIGURED_MESSAGE);
    case 'timeout':
      return errorResponse(HTTP_GATEWAY_TIMEOUT, 'llm_timeout', LLM_FAILED_MESSAGE);
    case 'provider':
      return errorResponse(HTTP_BAD_GATEWAY, 'llm_unavailable', LLM_FAILED_MESSAGE);
    case 'invalid_output':
      return errorResponse(HTTP_BAD_GATEWAY, 'llm_invalid_output', LLM_FAILED_MESSAGE);
    default:
      return null;
  }
}

/**
 * Legge il body JSON di una richiesta. Un body vuoto vale `{}` se `allowEmpty`,
 * altrimenti (come un JSON malformato) è un fallimento.
 */
export async function readJsonBody(
  request: Request,
  options: { allowEmpty: boolean }
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false };
  }
  if (text.trim() === '') {
    return options.allowEmpty ? { ok: true, value: {} } : { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
