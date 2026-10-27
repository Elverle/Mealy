// Client fetch generico per le API JSON dell'app.
// Importabile dai componenti "use client": nessuna dipendenza dal DB.

import type { z } from 'zod';

const NETWORK_ERROR_MESSAGE = 'Connessione non disponibile.';
export const UNKNOWN_ERROR_MESSAGE = 'Qualcosa è andato storto. Riprova.';
const INVALID_RESPONSE_MESSAGE = 'Risposta del server non valida.';

/**
 * Errore di `requestJson` in ogni caso di fallimento: rete (`status` 0,
 * `network_error`), risposta non 2xx, o risposta 2xx con forma inattesa
 * (`invalid_response`).
 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

/** Messaggio mostrabile all'utente: quello dell'errore API, altrimenti il generico. */
export function apiErrorMessage(err: unknown): string {
  return err instanceof ApiRequestError ? err.message : UNKNOWN_ERROR_MESSAGE;
}

/**
 * Esegue una richiesta e valida il corpo 2xx con `schema`.
 * Aggiunge `content-type: application/json` quando c'è un body.
 */
export async function requestJson<T>(
  url: string,
  init: RequestInit,
  schema: z.ZodType<T, unknown>
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body != null && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new ApiRequestError(0, 'network_error', NETWORK_ERROR_MESSAGE);
  }

  if (!response.ok) {
    let errorBody: { error?: { code?: unknown; message?: unknown } } | undefined;
    try {
      errorBody = await response.json();
    } catch {
      throw new ApiRequestError(response.status, 'unknown_error', UNKNOWN_ERROR_MESSAGE);
    }
    const code = errorBody?.error?.code;
    const message = errorBody?.error?.message;
    throw new ApiRequestError(
      response.status,
      typeof code === 'string' ? code : 'unknown_error',
      typeof message === 'string' ? message : UNKNOWN_ERROR_MESSAGE
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiRequestError(response.status, 'invalid_response', INVALID_RESPONSE_MESSAGE);
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiRequestError(response.status, 'invalid_response', INVALID_RESPONSE_MESSAGE);
  }
  return parsed.data;
}
