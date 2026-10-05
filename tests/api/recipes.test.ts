// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as listGET, runtime, dynamic } from '@/app/api/recipes/route';
import {
  GET as detailGET,
  runtime as detailRuntime,
  dynamic as detailDynamic,
} from '@/app/api/recipes/[id]/route';
import { EMPTY_LIBRARY_FILTER } from '@/lib/domain/types';
import { getRecipeDetail, listLibrary } from '@/lib/library/service';

vi.mock('@/lib/library/service', () => ({
  listLibrary: vi.fn(),
  getRecipeDetail: vi.fn(),
}));

const UUID = '3f2b6c1e-8a4d-4e0b-9c7a-1d2e3f4a5b6c';

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
