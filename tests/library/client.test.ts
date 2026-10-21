import { describe, it, expect, vi, afterEach } from 'vitest';
import { fixtureRecipesAsDomain } from '@/fixtures';
import { fetchRecipeDetail, requestRecipeProposal, requestSaveRecipe } from '@/lib/library/client';
import { ApiRequestError } from '@/lib/http/client';
import type { GeneratedRecipe } from '@/lib/domain/types';

const GENERATED_RECIPE: GeneratedRecipe = {
  title: 'Pasta al pomodoro',
  description: 'Un classico veloce.',
  meal_types: ['pranzo', 'cena'],
  courses: ['primo'],
  tags: ['veloce'],
  diet_flags: [],
  appliances_required: ['fornelli'],
  servings_base: 2,
  prep_minutes: 20,
  kcal_est: 450,
  steps: ['Cuoci la pasta.'],
  ingredients: [
    { canonical_name: 'pasta', display_name: 'Pasta', qty: 200, unit: 'g', category: 'dispensa', note: null },
  ],
};

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

describe('requestRecipeProposal', () => {
  it('POSTs the request to /api/recipes/propose and parses the proposal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { recipe: GENERATED_RECIPE, duplicate_of: null })
    );
    vi.stubGlobal('fetch', fetchMock);

    const proposal = await requestRecipeProposal({
      request: 'pasta veloce',
      mealType: 'cena',
      excludeTitles: ['Lasagne al pesto'],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/recipes/propose');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      request: 'pasta veloce',
      meal_type: 'cena',
      exclude_titles: ['Lasagne al pesto'],
    });
    expect(proposal).toEqual({ recipe: GENERATED_RECIPE, duplicate_of: null });
  });

  it('sends meal_type null when the model decides the meal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { recipe: GENERATED_RECIPE, duplicate_of: null }));
    vi.stubGlobal('fetch', fetchMock);

    await requestRecipeProposal({ request: 'pasta', mealType: null, excludeTitles: [] });

    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      request: 'pasta',
      meal_type: null,
      exclude_titles: [],
    });
  });

  it('passes the abort signal to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { recipe: GENERATED_RECIPE, duplicate_of: null }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await requestRecipeProposal({ request: 'pasta', mealType: null, excludeTitles: [] }, controller.signal);

    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal);
  });
});

describe('requestSaveRecipe', () => {
  it('POSTs the recipe to /api/recipes and returns the saved recipe', async () => {
    const saved = fixtureRecipesAsDomain()[0];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { recipe: saved }));
    vi.stubGlobal('fetch', fetchMock);

    const recipe = await requestSaveRecipe(GENERATED_RECIPE);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/recipes');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ recipe: GENERATED_RECIPE });
    expect(recipe.id).toBe(saved.id);
    expect(recipe.created_at).toBeInstanceOf(Date);
  });

  it('rejects with ApiRequestError carrying the recipe_duplicate code and message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(409, { error: { code: 'recipe_duplicate', message: 'Questa ricetta è già in libreria.' } })
      )
    );

    const error = await requestSaveRecipe(GENERATED_RECIPE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 409,
      code: 'recipe_duplicate',
      message: 'Questa ricetta è già in libreria.',
    });
  });
});
