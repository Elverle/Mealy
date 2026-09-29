// @vitest-environment node

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  errorResponse,
  internalErrorResponse,
  invalidRequestResponse,
  llmErrorResponse,
  readJsonBody,
} from '@/lib/http/responses';
import { LlmError } from '@/lib/llm/errors';

function requestWithBody(body: string): Request {
  return new Request('http://localhost/x', { method: 'POST', body });
}

describe('errorResponse', () => {
  it('builds the standard envelope, with details only when given', async () => {
    const plain = errorResponse(404, 'not_found', 'Non trovato.');
    expect(plain.status).toBe(404);
    expect(await plain.json()).toEqual({ error: { code: 'not_found', message: 'Non trovato.' } });

    const detailed = errorResponse(400, 'bad', 'Male.', [{ path: 'a', message: 'x' }]);
    expect(await detailed.json()).toEqual({
      error: { code: 'bad', message: 'Male.', details: [{ path: 'a', message: 'x' }] },
    });
  });
});

describe('invalidRequestResponse', () => {
  it('returns 400 invalid_request without details when no issues are given', async () => {
    const response = invalidRequestResponse();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'invalid_request', message: 'Richiesta non valida.' },
    });
  });

  it('maps zod issues to path/message details', async () => {
    const parsed = z.object({ a: z.object({ b: z.number() }) }).safeParse({ a: { b: 'x' } });
    if (parsed.success) throw new Error('expected a validation failure');

    const response = invalidRequestResponse(parsed.error.issues);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.details).toEqual([{ path: 'a.b', message: expect.any(String) }]);
  });
});

describe('internalErrorResponse', () => {
  it('returns 500 internal_error', async () => {
    const response = internalErrorResponse();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal_error', message: 'Qualcosa è andato storto. Riprova.' },
    });
  });
});

describe('llmErrorResponse', () => {
  it.each([
    ['config', 500, 'llm_not_configured', 'Generazione non disponibile: il modello non è configurato.'],
    ['timeout', 504, 'llm_timeout', 'La generazione non è andata a buon fine. Riprova.'],
    ['provider', 502, 'llm_unavailable', 'La generazione non è andata a buon fine. Riprova.'],
    ['invalid_output', 502, 'llm_invalid_output', 'La generazione non è andata a buon fine. Riprova.'],
  ] as const)('maps LlmError(%s) to %i %s', async (code, status, errorCode, message) => {
    const response = llmErrorResponse(new LlmError(code, 'internal detail'));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(status);
    expect(await response!.json()).toEqual({ error: { code: errorCode, message } });
  });

  it('returns null for errors that are not LlmError', () => {
    expect(llmErrorResponse(new Error('boom'))).toBeNull();
    expect(llmErrorResponse('boom')).toBeNull();
  });
});

describe('readJsonBody', () => {
  it('treats an empty body as {} when allowEmpty', async () => {
    await expect(readJsonBody(requestWithBody(''), { allowEmpty: true })).resolves.toEqual({
      ok: true,
      value: {},
    });
    await expect(readJsonBody(requestWithBody('  \n'), { allowEmpty: true })).resolves.toEqual({
      ok: true,
      value: {},
    });
  });

  it('fails on an empty body when not allowEmpty', async () => {
    await expect(readJsonBody(requestWithBody(''), { allowEmpty: false })).resolves.toEqual({
      ok: false,
    });
  });

  it('fails on malformed JSON', async () => {
    await expect(readJsonBody(requestWithBody('{'), { allowEmpty: true })).resolves.toEqual({
      ok: false,
    });
  });

  it('parses a valid JSON body', async () => {
    await expect(readJsonBody(requestWithBody('{"a":1}'), { allowEmpty: false })).resolves.toEqual({
      ok: true,
      value: { a: 1 },
    });
  });
});
