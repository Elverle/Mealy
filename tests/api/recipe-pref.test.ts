// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PUT, runtime, dynamic } from '@/app/api/recipes/[id]/pref/route';
import { updateRecipePref } from '@/lib/prefs/service';

vi.mock('@/lib/prefs/service', () => ({
  updateRecipePref: vi.fn(),
}));

const UUID = '3f2b6c1e-8a4d-4e0b-9c7a-1d2e3f4a5b6c';

function put(id: string, body?: string) {
  return PUT(
    new Request(`http://localhost/api/recipes/${id}/pref`, { method: 'PUT', body }),
    { params: Promise.resolve({ id }) }
  );
}

describe('PUT /api/recipes/[id]/pref', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('exports route segment configuration', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
  });

  it('returns 200 with { prefs }', async () => {
    const prefs = { recipe_id: UUID, rating: 4, favorite: false, blocked: false, times_used: 0, last_used_at: null };
    vi.mocked(updateRecipePref).mockResolvedValueOnce(prefs);

    const response = await put(UUID, JSON.stringify({ rating: 4 }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ prefs });
    expect(updateRecipePref).toHaveBeenCalledWith(UUID, { rating: 4 });
  });

  it('returns 400 for an empty body', async () => {
    const response = await put(UUID);
    expect(response.status).toBe(400);
    expect(updateRecipePref).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty object', async () => {
    const response = await put(UUID, '{}');
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
  });

  it('returns 400 for an out-of-range rating', async () => {
    const response = await put(UUID, JSON.stringify({ rating: 9 }));
    expect(response.status).toBe(400);
    expect(updateRecipePref).not.toHaveBeenCalled();
  });

  it('returns 404 recipe_not_found when the service returns null', async () => {
    vi.mocked(updateRecipePref).mockResolvedValueOnce(null);

    const response = await put(UUID, JSON.stringify({ favorite: true }));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('recipe_not_found');
  });

  it('returns 404 for a non-UUID id without calling the service', async () => {
    const response = await put('abc', JSON.stringify({ favorite: true }));
    expect(response.status).toBe(404);
    expect(updateRecipePref).not.toHaveBeenCalled();
  });

  it('maps a service error to 500', async () => {
    vi.mocked(updateRecipePref).mockRejectedValueOnce(new Error('secret boom'));

    const response = await put(UUID, JSON.stringify({ favorite: true }));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('boom');
  });
});
