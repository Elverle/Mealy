import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { ApiRequestError, requestJson } from '@/lib/http/client';

const Schema = z.object({ ok: z.literal(true), n: z.number().default(0) });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestJson', () => {
  it('returns the schema-parsed body on a valid 2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ok: true })));

    await expect(requestJson('/x', { method: 'GET' }, Schema)).resolves.toEqual({ ok: true, n: 0 });
  });

  it('sends content-type application/json only when there is a body', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(200, { ok: true })));
    vi.stubGlobal('fetch', fetchMock);

    await requestJson('/x', { method: 'POST', body: '{}' }, Schema);
    await requestJson('/x', { method: 'GET' }, Schema);

    const withBody = fetchMock.mock.calls[0][1] as RequestInit;
    const withoutBody = fetchMock.mock.calls[1][1] as RequestInit;
    expect(new Headers(withBody.headers).get('content-type')).toBe('application/json');
    expect(new Headers(withoutBody.headers).has('content-type')).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe('/x');
    expect(withBody.method).toBe('POST');
    expect(withBody.body).toBe('{}');
  });

  it('throws network_error with status 0 when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));

    const error = await requestJson('/x', {}, Schema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 0,
      code: 'network_error',
      message: 'Connessione non disponibile.',
    });
  });

  it('throws code and message from the { error } body on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(422, { error: { code: 'no_alternatives', message: 'Nessuna alternativa.' } })
        )
    );

    await expect(requestJson('/x', {}, Schema)).rejects.toMatchObject({
      status: 422,
      code: 'no_alternatives',
      message: 'Nessuna alternativa.',
    });
  });

  it('throws unknown_error on non-2xx with an unreadable body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 500 })));

    await expect(requestJson('/x', {}, Schema)).rejects.toMatchObject({
      status: 500,
      code: 'unknown_error',
      message: 'Qualcosa è andato storto. Riprova.',
    });
  });

  it('throws unknown_error on non-2xx with a body that has no { error }', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, { nope: 1 })));

    await expect(requestJson('/x', {}, Schema)).rejects.toMatchObject({
      status: 503,
      code: 'unknown_error',
      message: 'Qualcosa è andato storto. Riprova.',
    });
  });

  it('throws invalid_response on a 2xx body that does not match the schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ok: false })));

    await expect(requestJson('/x', {}, Schema)).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
      message: 'Risposta del server non valida.',
    });
  });

  it('throws invalid_response on a 2xx body that is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })));

    await expect(requestJson('/x', {}, Schema)).rejects.toMatchObject({
      status: 200,
      code: 'invalid_response',
    });
  });
});
