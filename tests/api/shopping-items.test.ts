// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as itemRoute from '@/app/api/shopping-items/[id]/route';
import { SHOPPING_ERROR_CODES, SHOPPING_ERROR_HTTP, ShoppingError } from '@/lib/shopping/errors';
import { checkShoppingItem, removeManualShoppingItem } from '@/lib/shopping/service';

vi.mock('@/lib/shopping/service', () => ({
  getPlanShoppingList: vi.fn(),
  buildPlanShoppingList: vi.fn(),
  checkShoppingItem: vi.fn(),
  addManualShoppingItem: vi.fn(),
  removeManualShoppingItem: vi.fn(),
  getShoppingScreen: vi.fn(),
}));

const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const MOCK_ITEM = { marker: 'item-from-service' };

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patch(body: string): Request {
  return new Request('http://localhost/api/shopping-items/x', { method: 'PATCH', body });
}

function del(): Request {
  return new Request('http://localhost/api/shopping-items/x', { method: 'DELETE' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PATCH /api/shopping-items/:id', () => {
  it('exports runtime and dynamic', () => {
    expect(itemRoute.runtime).toBe('nodejs');
    expect(itemRoute.dynamic).toBe('force-dynamic');
  });

  it('returns 200 with the item and calls the service with the checked value', async () => {
    vi.mocked(checkShoppingItem).mockResolvedValueOnce(MOCK_ITEM as never);

    const response = await itemRoute.PATCH(patch('{"checked":true}'), params(ITEM_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ item: MOCK_ITEM });
    expect(checkShoppingItem).toHaveBeenCalledWith(ITEM_ID, true);
  });

  it('rejects an empty body with 400 invalid_request', async () => {
    const response = await itemRoute.PATCH(patch(''), params(ITEM_ID));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
    expect(checkShoppingItem).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean checked with 400', async () => {
    const response = await itemRoute.PATCH(patch('{"checked":"si"}'), params(ITEM_ID));

    expect(response.status).toBe(400);
    expect(checkShoppingItem).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID id with 404 item_not_found without calling the service', async () => {
    const response = await itemRoute.PATCH(patch('{"checked":true}'), params('abc'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('item_not_found');
    expect(checkShoppingItem).not.toHaveBeenCalled();
  });

  it('maps item_not_found from the service to 404', async () => {
    vi.mocked(checkShoppingItem).mockRejectedValueOnce(new ShoppingError('item_not_found'));

    const response = await itemRoute.PATCH(patch('{"checked":true}'), params(ITEM_ID));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('item_not_found');
  });

  it('maps plan_archived from the service to 409', async () => {
    vi.mocked(checkShoppingItem).mockRejectedValueOnce(new ShoppingError('plan_archived'));

    const response = await itemRoute.PATCH(patch('{"checked":false}'), params(ITEM_ID));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('plan_archived');
  });

  it('maps an unexpected error to 500 without leaking the message', async () => {
    vi.mocked(checkShoppingItem).mockRejectedValueOnce(new Error('boom secret'));

    const response = await itemRoute.PATCH(patch('{"checked":true}'), params(ITEM_ID));

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('boom');
    expect(JSON.parse(text).error.code).toBe('internal_error');
  });

  it.each(SHOPPING_ERROR_CODES)('answers %s with the status of SHOPPING_ERROR_HTTP', async (code) => {
    vi.mocked(checkShoppingItem).mockRejectedValueOnce(new ShoppingError(code));

    const response = await itemRoute.PATCH(patch('{"checked":true}'), params(ITEM_ID));

    expect(response.status).toBe(SHOPPING_ERROR_HTTP[code].status);
    expect((await response.json()).error.code).toBe(code);
  });
});

describe('DELETE /api/shopping-items/:id', () => {
  it('returns 200 with the removed id', async () => {
    vi.mocked(removeManualShoppingItem).mockResolvedValueOnce(ITEM_ID);

    const response = await itemRoute.DELETE(del(), params(ITEM_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: ITEM_ID });
    expect(removeManualShoppingItem).toHaveBeenCalledWith(ITEM_ID);
  });

  it('maps item_not_manual to 409 with its message', async () => {
    vi.mocked(removeManualShoppingItem).mockRejectedValueOnce(new ShoppingError('item_not_manual'));

    const response = await itemRoute.DELETE(del(), params(ITEM_ID));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toEqual({
      code: 'item_not_manual',
      message: 'Si possono rimuovere solo gli articoli aggiunti a mano.',
    });
  });

  it('rejects a non-UUID id with 404 without calling the service', async () => {
    const response = await itemRoute.DELETE(del(), params('abc'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('item_not_found');
    expect(removeManualShoppingItem).not.toHaveBeenCalled();
  });

  it.each(SHOPPING_ERROR_CODES)('answers %s with the status of SHOPPING_ERROR_HTTP', async (code) => {
    vi.mocked(removeManualShoppingItem).mockRejectedValueOnce(new ShoppingError(code));

    const response = await itemRoute.DELETE(del(), params(ITEM_ID));

    expect(response.status).toBe(SHOPPING_ERROR_HTTP[code].status);
    expect((await response.json()).error.code).toBe(code);
  });
});
