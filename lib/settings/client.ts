// Funzione client per salvare le impostazioni via `PUT /api/settings`.
// Importabile dai componenti "use client": nessuna dipendenza dal DB.

import {
  SaveSettingsResultSchema,
  type SaveSettingsResult,
  type UpdateSettingsRequest,
} from '@/lib/domain/types';

/**
 * Errore lanciato da `putSettings` in ogni caso di fallimento: rete,
 * risposta non 2xx dal server, o risposta 2xx con forma inattesa.
 */
export class SettingsRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SettingsRequestError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Invia le impostazioni aggiornate a `PUT /api/settings` e ritorna il
 * risultato validato. Lancia `SettingsRequestError` per errori di rete,
 * risposte non 2xx, o risposte 2xx con corpo non conforme.
 */
export async function putSettings(
  body: UpdateSettingsRequest
): Promise<SaveSettingsResult> {
  let response: Response;
  try {
    response = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SettingsRequestError(0, 'network_error', 'Connessione non disponibile.');
  }

  if (!response.ok) {
    let errorBody: { error?: { code?: string; message?: string } } | undefined;
    try {
      errorBody = await response.json();
    } catch {
      throw new SettingsRequestError(
        response.status,
        'unknown_error',
        'Qualcosa è andato storto. Riprova.'
      );
    }
    throw new SettingsRequestError(
      response.status,
      errorBody?.error?.code ?? 'unknown_error',
      errorBody?.error?.message ?? 'Qualcosa è andato storto. Riprova.'
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new SettingsRequestError(
      response.status,
      'invalid_response',
      'Risposta del server non valida.'
    );
  }

  const parsed = SaveSettingsResultSchema.safeParse(json);
  if (!parsed.success) {
    throw new SettingsRequestError(
      response.status,
      'invalid_response',
      'Risposta del server non valida.'
    );
  }

  return parsed.data;
}
