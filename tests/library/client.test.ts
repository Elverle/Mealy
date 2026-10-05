import { describe, it, expect, vi, afterEach } from 'vitest';
import { fixtureRecipesAsDomain } from '@/fixtures';
import { fetchRecipeDetail } from '@/lib/library/client';
import { ApiRequestError } from '@/lib/http/client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchRecipeDetail', () => {
  it('GETs /api/recipes/{id} and parses the detail view', async () => {
    const recipe = fixtureRecipesAsDomain()[0];
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { recipe, ingredients: [{ canonical_name: 'sale', pref: null, recipes_count: 3 }] })
      );
    vi.stubGlobal('fetch', fetchMock);

    const view = await fetchRecipeDetail(recipe.id);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/recipes/${recipe.id}`);
    expect(init.method).toBe('GET');
    expect(view.recipe.id).toBe(recipe.id);
    expect(view.ingredients).toEqual([{ canonical_name: 'sale', pref: null, recipes_count: 3 }]);
  });

  it('encodes the recipe id in the path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { error: { code: 'not_found', message: 'x' } }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchRecipeDetail('a b/c').catch(() => undefined);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/recipes/a%20b%2Fc');
  });

  it('throws ApiRequestError with the server code on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse(404, { error: { code: 'not_found', message: 'Ricetta non trovata.' } }))
    );

    const error = await fetchRecipeDetail('x').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'Ricetta non trovata.' });
  });
});
