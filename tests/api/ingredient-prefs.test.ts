// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, runtime, dynamic } from '@/app/api/ingredient-prefs/route';
import {
  PUT,
  runtime as putRuntime,
  dynamic as putDynamic,
} from '@/app/api/ingredient-prefs/[canonicalName]/route';
import { listIngredientPrefs, setIngredientPref } from '@/lib/prefs/service';

vi.mock('@/lib/prefs/service', () => ({
  listIngredientPrefs: vi.fn(),
  setIngredientPref: vi.fn(),
}));

function put(canonicalName: string, body?: string) {
  return PUT(
    new Request('http://localhost/api/ingredient-prefs/x', { method: 'PUT', body }),
    { params: Promise.resolve({ canonicalName }) }
  );
}

describe('GET /api/ingredient-prefs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('exports route segment configuration', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
  });

  it('returns 200 with the view', async () => {
    const view = { likes: [], dislikes: [{ canonical_name: 'cipolla', pref: 'dislike' as const, recipes_count: 2 }] };
    vi.mocked(listIngredientPrefs).mockResolvedValueOnce(view);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(view);
  });

  it('maps a service error to 500', async () => {
    vi.mocked(listIngredientPrefs).mockRejectedValueOnce(new Error('secret boom'));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('boom');
  });
});

describe('PUT /api/ingredient-prefs/[canonicalName]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('exports route segment configuration', () => {
    expect(putRuntime).toBe('nodejs');
    expect(putDynamic).toBe('force-dynamic');
  });

  it('passes the already-decoded param to the service', async () => {
    vi.mocked(setIngredientPref).mockResolvedValueOnce({
      canonical_name: 'cipolla rossa',
      pref: 'like',
      recipes_count: 1,
    });

    const response = await put('cipolla rossa', JSON.stringify({ pref: 'like' }));

    expect(response.status).toBe(200);
    expect(setIngredientPref).toHaveBeenCalledWith('cipolla rossa', 'like');
  });

  it('does not decode the param a second time', async () => {
    vi.mocked(setIngredientPref).mockResolvedValueOnce({
      canonical_name: 'a%20b',
      pref: 'like',
      recipes_count: 0,
    });

    const response = await put('a%20b', JSON.stringify({ pref: 'like' }));

    expect(response.status).toBe(200);
    expect(setIngredientPref).toHaveBeenCalledWith('a%20b', 'like');
  });

  it('returns 400 for a name containing a NUL character', async () => {
    const response = await put('sale\u0000', JSON.stringify({ pref: 'like' }));
    expect(response.status).toBe(400);
    expect(setIngredientPref).not.toHaveBeenCalled();
  });

  it('keeps an already-decoded name containing a percent sign', async () => {
    vi.mocked(setIngredientPref).mockResolvedValueOnce({
      canonical_name: 'cioccolato 70%',
      pref: 'like',
      recipes_count: 0,
    });

    const response = await put('cioccolato 70%', JSON.stringify({ pref: 'like' }));

    expect(response.status).toBe(200);
    expect(setIngredientPref).toHaveBeenCalledWith('cioccolato 70%', 'like');
  });

  it('returns 400 for a whitespace-only name', async () => {
    const response = await put('  ', JSON.stringify({ pref: 'like' }));
    expect(response.status).toBe(400);
    expect(setIngredientPref).not.toHaveBeenCalled();
  });

  it('returns 400 for a name longer than the limit', async () => {
    const response = await put('a'.repeat(81), JSON.stringify({ pref: 'like' }));
    expect(response.status).toBe(400);
  });

  it('returns 400 for an unknown pref value', async () => {
    const response = await put('cipolla', JSON.stringify({ pref: 'boh' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.details).toBeDefined();
  });

  it('returns 400 for an empty body', async () => {
    const response = await put('cipolla');
    expect(response.status).toBe(400);
  });

  it('accepts pref null to remove the judgement', async () => {
    vi.mocked(setIngredientPref).mockResolvedValueOnce({
      canonical_name: 'cipolla',
      pref: null,
      recipes_count: 3,
    });

    const response = await put('cipolla', JSON.stringify({ pref: null }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ canonical_name: 'cipolla', pref: null, recipes_count: 3 });
    expect(setIngredientPref).toHaveBeenCalledWith('cipolla', null);
  });

  it('maps a service error to 500', async () => {
    vi.mocked(setIngredientPref).mockRejectedValueOnce(new Error('secret boom'));

    const response = await put('cipolla', JSON.stringify({ pref: 'like' }));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('boom');
  });
});
