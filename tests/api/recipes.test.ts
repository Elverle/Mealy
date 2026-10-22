// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  GET as listGET,
  POST as savePOST,
  runtime,
  dynamic,
} from '@/app/api/recipes/route';
import {
  GET as detailGET,
  runtime as detailRuntime,
  dynamic as detailDynamic,
} from '@/app/api/recipes/[id]/route';
import {
  EMPTY_LIBRARY_FILTER,
  SAVED_RECIPE_TEXT_MAX,
  type GeneratedRecipe,
} from '@/lib/domain/types';
import { filterLibraryCards } from '@/lib/domain/library';
import { getRecipeDetail, listLibrary } from '@/lib/library/service';
import { RecipeError } from '@/lib/recipes/errors';
import { saveProposedRecipe } from '@/lib/recipes/propose';
import { makeLibraryCard } from '@/tests/helpers/recipes';

vi.mock('@/lib/library/service', () => ({
  listLibrary: vi.fn(),
  getRecipeDetail: vi.fn(),
}));

vi.mock('@/lib/recipes/propose', () => ({
  proposeRecipe: vi.fn(),
  saveProposedRecipe: vi.fn(),
}));

const UUID = '3f2b6c1e-8a4d-4e0b-9c7a-1d2e3f4a5b6c';

function validRecipe(): GeneratedRecipe {
  return {
    title: 'Lasagne al pesto',
    description: 'Lasagne con pesto di basilico.',
    meal_types: ['pranzo', 'cena'],
    courses: ['primo'],
    tags: ['comfort-food'],
    diet_flags: ['vegetariano'],
    appliances_required: ['fornelli', 'forno'],
    servings_base: 2,
    prep_minutes: 60,
    kcal_est: 640,
    steps: ['Lessa le patate.', 'Inforna a 180 °C per 30 minuti.'],
    ingredients: [
      {
        canonical_name: 'Basilico',
        display_name: 'basilico fresco',
        qty: 50,
        unit: 'g',
        category: 'ortofrutta',
        note: null,
      },
      {
        canonical_name: 'sale',
        display_name: 'sale',
        qty: null,
        unit: 'qb',
        category: 'dispensa',
        note: null,
      },
    ],
  };
}

function postSave(body?: string): Request {
  return new Request('http://localhost/api/recipes', { method: 'POST', body });
}

function detailParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/recipes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('exports route segment configuration', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
  });

  it('passes the parsed filter to the service', async () => {
    vi.mocked(listLibrary).mockResolvedValueOnce({ recipes: [], total: 0 });

    const response = await listGET(new Request('http://localhost/api/recipes?tag=veloce&preferite=1'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recipes: [], total: 0 });
    expect(listLibrary).toHaveBeenCalledWith({ ...EMPTY_LIBRARY_FILTER, tags: ['veloce'], favorites: true });
  });

  it('passes the portata parameter to the service, deduped', async () => {
    vi.mocked(listLibrary).mockResolvedValueOnce({ recipes: [], total: 0 });

    const response = await listGET(new Request('http://localhost/api/recipes?portata=primo&portata=primo'));

    expect(response.status).toBe(200);
    expect(listLibrary).toHaveBeenCalledWith({ ...EMPTY_LIBRARY_FILTER, courses: ['primo'] });
  });

  it('returns only the cards of the requested course, each with its courses', async () => {
    // Servizio con le card in memoria, filtrate dal filtro reale di libreria (nessun DB).
    const primo = makeLibraryCard({ title: 'Lasagne', courses: ['primo'] });
    const secondo = makeLibraryCard({ title: 'Pollo', courses: ['secondo', 'contorno'] });
    const nonClassificata = makeLibraryCard({ title: 'Vecchia ricetta', courses: [] });
    const cards = [primo, secondo, nonClassificata];
    vi.mocked(listLibrary).mockImplementationOnce(async (filter) => ({
      recipes: filterLibraryCards(cards, filter),
      total: cards.length,
    }));

    const response = await listGET(new Request('http://localhost/api/recipes?portata=primo'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(3);
    expect(body.recipes.map((card: { id: string }) => card.id)).toEqual([primo.id]);
    expect(body.recipes[0].courses).toEqual(['primo']);
  });

  it('returns 400 invalid_request for an unknown course', async () => {
    const response = await listGET(new Request('http://localhost/api/recipes?portata=xyz'));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('invalid_request');
    expect(listLibrary).not.toHaveBeenCalled();
  });

  it('returns 400 invalid_request with details for an invalid meal', async () => {
    const response = await listGET(new Request('http://localhost/api/recipes?pasto=colazione'));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.details.length).toBeGreaterThan(0);
    expect(listLibrary).not.toHaveBeenCalled();
  });

  it('maps a service error to 500 without leaking the message', async () => {
    vi.mocked(listLibrary).mockRejectedValueOnce(new Error('secret boom'));

    const response = await listGET(new Request('http://localhost/api/recipes'));

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain('internal_error');
    expect(text).not.toContain('boom');
  });
});

describe('GET /api/recipes/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('exports route segment configuration', () => {
    expect(detailRuntime).toBe('nodejs');
    expect(detailDynamic).toBe('force-dynamic');
  });

  it('returns 200 with the detail', async () => {
    const detail = { recipe: { id: UUID }, ingredients: [] };
    vi.mocked(getRecipeDetail).mockResolvedValueOnce(detail as never);

    const response = await detailGET(new Request(`http://localhost/api/recipes/${UUID}`), detailParams(UUID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(detail);
    expect(getRecipeDetail).toHaveBeenCalledWith(UUID);
  });

  it('returns 404 recipe_not_found when the service returns null', async () => {
    vi.mocked(getRecipeDetail).mockResolvedValueOnce(null);

    const response = await detailGET(new Request(`http://localhost/api/recipes/${UUID}`), detailParams(UUID));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'recipe_not_found', message: 'Ricetta non trovata.' },
    });
  });

  it('returns 404 for a non-UUID id without calling the service', async () => {
    const response = await detailGET(new Request('http://localhost/api/recipes/abc'), detailParams('abc'));

    expect(response.status).toBe(404);
    expect(getRecipeDetail).not.toHaveBeenCalled();
  });

  it('maps a service error to 500', async () => {
    vi.mocked(getRecipeDetail).mockRejectedValueOnce(new Error('secret boom'));

    const response = await detailGET(new Request(`http://localhost/api/recipes/${UUID}`), detailParams(UUID));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('boom');
  });
});

describe('POST /api/recipes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns 201 with the saved recipe and passes the normalized recipe to the service', async () => {
    const saved = { id: UUID, title: 'Lasagne al pesto' };
    vi.mocked(saveProposedRecipe).mockResolvedValueOnce(saved as never);

    const response = await savePOST(postSave(JSON.stringify({ recipe: validRecipe() })));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ recipe: saved });
    expect(saveProposedRecipe).toHaveBeenCalledWith({
      recipe: expect.objectContaining({
        ingredients: expect.arrayContaining([
          expect.objectContaining({ canonical_name: 'basilico' }),
        ]),
      }),
    });
  });

  it.each([
    ['an empty body', undefined],
    ['an empty object', '{}'],
    [
      'a recipe without ingredients',
      JSON.stringify({ recipe: (({ ingredients: _omitted, ...rest }) => rest)(validRecipe()) }),
    ],
    ['an extra key next to the recipe', JSON.stringify({ recipe: validRecipe(), extra: 1 })],
    [
      'a recipe whose only step is blank (valid for the schema, invalid after normalization)',
      JSON.stringify({ recipe: { ...validRecipe(), steps: ['   '] } }),
    ],
    [
      'a recipe with a description over the size limit',
      JSON.stringify({ recipe: { ...validRecipe(), description: 'a'.repeat(SAVED_RECIPE_TEXT_MAX + 1) } }),
    ],
  ])('rejects %s with 400 invalid_request without calling the service', async (_label, body) => {
    const response = await savePOST(postSave(body));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
    expect(saveProposedRecipe).not.toHaveBeenCalled();
  });

  it('maps RecipeError(recipe_duplicate) to 409', async () => {
    vi.mocked(saveProposedRecipe).mockRejectedValueOnce(new RecipeError('recipe_duplicate'));

    const response = await savePOST(postSave(JSON.stringify({ recipe: validRecipe() })));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'recipe_duplicate', message: 'Questa ricetta è già in libreria.' },
    });
  });

  it('maps RecipeError(recipe_unsuitable) to 422', async () => {
    vi.mocked(saveProposedRecipe).mockRejectedValueOnce(new RecipeError('recipe_unsuitable'));

    const response = await savePOST(postSave(JSON.stringify({ recipe: validRecipe() })));

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('recipe_unsuitable');
  });

  it('maps an unexpected error to 500 internal_error without leaking the message', async () => {
    vi.mocked(saveProposedRecipe).mockRejectedValueOnce(new Error('secret boom'));

    const response = await savePOST(postSave(JSON.stringify({ recipe: validRecipe() })));

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain('internal_error');
    expect(text).not.toContain('secret boom');
  });
});
