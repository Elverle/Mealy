import { describe, it, expect, vi, afterEach } from 'vitest';
import { putIngredientPref, putRecipePref } from '@/lib/prefs/client';
import { ApiRequestError } from '@/lib/http/client';

const RECIPE_ID = '11111111-1111-4111-8111-111111111111';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('putRecipePref', () => {
  it('PUTs the patch to /api/recipes/{id}/pref and returns the prefs object', async () => {
    const prefs = {
      recipe_id: RECIPE_ID,
      rating: 4,
      favorite: true,
      blocked: false,
      times_used: 0,
      last_used_at: null,
    };
    const fetchMock = stubFetch(jsonResponse(200, { prefs }));

    await expect(putRecipePref(RECIPE_ID, { rating: 4, favorite: true })).resolves.toEqual(prefs);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/recipes/${RECIPE_ID}/pref`);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ rating: 4, favorite: true });
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('throws ApiRequestError with the server code on a non-2xx response', async () => {
    stubFetch(jsonResponse(404, { error: { code: 'not_found', message: 'Ricetta non trovata.' } }));

    const error = await putRecipePref(RECIPE_ID, { blocked: true }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 404, code: 'not_found' });
  });
});

describe('putIngredientPref', () => {
  it('PUTs { pref } to the encoded ingredient path', async () => {
    const result = { canonical_name: 'cipolla rossa', pref: 'dislike', recipes_count: 2 };
    const fetchMock = stubFetch(jsonResponse(200, result));

    await expect(putIngredientPref('cipolla rossa', 'dislike')).resolves.toEqual(result);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ingredient-prefs/cipolla%20rossa');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ pref: 'dislike' });
  });

  it('sends pref null to remove the judgement', async () => {
    const fetchMock = stubFetch(
      jsonResponse(200, { canonical_name: 'sale', pref: null, recipes_count: 5 })
    );

    await putIngredientPref('sale', null);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ pref: null });
  });

  it('throws ApiRequestError with the server code on a non-2xx response', async () => {
    stubFetch(jsonResponse(400, { error: { code: 'invalid_request', message: 'Richiesta non valida.' } }));

    const error = await putIngredientPref('sale', 'like').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 400, code: 'invalid_request' });
  });

  it('throws network_error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    await expect(putIngredientPref('sale', 'like')).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });
});
