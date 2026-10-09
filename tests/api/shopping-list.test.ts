// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as listRoute from '@/app/api/plans/[id]/shopping-list/route';
import * as itemsRoute from '@/app/api/plans/[id]/shopping-list/items/route';
import { ShoppingError } from '@/lib/shopping/errors';
import {
  addManualShoppingItem,
  buildPlanShoppingList,
  getPlanShoppingList,
} from '@/lib/shopping/service';

vi.mock('@/lib/shopping/service', () => ({
  getPlanShoppingList: vi.fn(),
  buildPlanShoppingList: vi.fn(),
  checkShoppingItem: vi.fn(),
  addManualShoppingItem: vi.fn(),
  removeManualShoppingItem: vi.fn(),
  getShoppingScreen: vi.fn(),
}));

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const MOCK_RESULT = { marker: 'from-service' };
const MOCK_ITEM = { marker: 'item-from-service' };

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postItem(body?: string): Request {
  return new Request('http://localhost/api/plans/x/shopping-list/items', {
    method: 'POST',
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('route della lista del piano', () => {
  it('exports runtime and dynamic from both files', () => {
    expect(listRoute.runtime).toBe('nodejs');
    expect(listRoute.dynamic).toBe('force-dynamic');
    expect(itemsRoute.runtime).toBe('nodejs');
    expect(itemsRoute.dynamic).toBe('force-dynamic');
  });

  describe('GET /api/plans/:id/shopping-list', () => {
    it('returns 200 with the service value', async () => {
      vi.mocked(getPlanShoppingList).mockResolvedValueOnce(MOCK_RESULT as never);

      const response = await listRoute.GET(new Request('http://localhost/x'), params(PLAN_ID));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(MOCK_RESULT);
      expect(getPlanShoppingList).toHaveBeenCalledWith(PLAN_ID);
    });

    it('rejects a non-UUID id with 404 plan_not_found without calling the service', async () => {
      const response = await listRoute.GET(new Request('http://localhost/x'), params('abc'));

      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe('plan_not_found');
      expect(getPlanShoppingList).not.toHaveBeenCalled();
    });

    it('maps ShoppingError plan_not_found to 404 with its message', async () => {
      vi.mocked(getPlanShoppingList).mockRejectedValueOnce(new ShoppingError('plan_not_found'));

      const response = await listRoute.GET(new Request('http://localhost/x'), params(PLAN_ID));

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toEqual({ code: 'plan_not_found', message: 'Piano non trovato.' });
    });

    it('maps an unexpected error to 500 internal_error without leaking the message', async () => {
      vi.mocked(getPlanShoppingList).mockRejectedValueOnce(new Error('boom secret'));

      const response = await listRoute.GET(new Request('http://localhost/x'), params(PLAN_ID));

      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).not.toContain('boom');
      expect(JSON.parse(text).error.code).toBe('internal_error');
    });
  });

  describe('POST /api/plans/:id/shopping-list', () => {
    it('returns 200 with the built list and ignores the body', async () => {
      vi.mocked(buildPlanShoppingList).mockResolvedValueOnce(MOCK_RESULT as never);

      const response = await listRoute.POST(
        new Request('http://localhost/x', { method: 'POST', body: 'non json' }),
        params(PLAN_ID)
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(MOCK_RESULT);
      expect(buildPlanShoppingList).toHaveBeenCalledWith(PLAN_ID);
    });

    it('rejects a non-UUID id with 404 without calling the service', async () => {
      const response = await listRoute.POST(new Request('http://localhost/x', { method: 'POST' }), params('abc'));

      expect(response.status).toBe(404);
      expect(buildPlanShoppingList).not.toHaveBeenCalled();
    });

    it('maps plan_not_confirmed to 409 with its message', async () => {
      vi.mocked(buildPlanShoppingList).mockRejectedValueOnce(new ShoppingError('plan_not_confirmed'));

      const response = await listRoute.POST(new Request('http://localhost/x', { method: 'POST' }), params(PLAN_ID));

      expect(response.status).toBe(409);
      expect((await response.json()).error).toEqual({
        code: 'plan_not_confirmed',
        message: 'Conferma il piano per creare la lista della spesa.',
      });
    });

    it('maps plan_archived to 409', async () => {
      vi.mocked(buildPlanShoppingList).mockRejectedValueOnce(new ShoppingError('plan_archived'));

      const response = await listRoute.POST(new Request('http://localhost/x', { method: 'POST' }), params(PLAN_ID));

      expect(response.status).toBe(409);
      expect((await response.json()).error.code).toBe('plan_archived');
    });
  });
});

describe('POST /api/plans/:id/shopping-list/items', () => {
  it('returns 201 with the item when it was created', async () => {
    vi.mocked(addManualShoppingItem).mockResolvedValueOnce({ item: MOCK_ITEM, created: true } as never);

    const response = await itemsRoute.POST(postItem('{"name":"latte"}'), params(PLAN_ID));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ item: MOCK_ITEM });
    expect(addManualShoppingItem).toHaveBeenCalledWith(PLAN_ID, 'latte');
  });

  it('returns 200 when the item already existed', async () => {
    vi.mocked(addManualShoppingItem).mockResolvedValueOnce({ item: MOCK_ITEM, created: false } as never);

    const response = await itemsRoute.POST(postItem('{"name":"latte"}'), params(PLAN_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ item: MOCK_ITEM });
  });

  it('passes the trimmed name to the service', async () => {
    vi.mocked(addManualShoppingItem).mockResolvedValueOnce({ item: MOCK_ITEM, created: true } as never);

    await itemsRoute.POST(postItem('{"name":"  latte "}'), params(PLAN_ID));

    expect(addManualShoppingItem).toHaveBeenCalledWith(PLAN_ID, 'latte');
  });

  it('rejects an empty body with 400 invalid_request', async () => {
    const response = await itemsRoute.POST(postItem(''), params(PLAN_ID));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
    expect(addManualShoppingItem).not.toHaveBeenCalled();
  });

  it('rejects a body without name with 400 and details', async () => {
    const response = await itemsRoute.POST(postItem('{}'), params(PLAN_ID));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.details.length).toBeGreaterThan(0);
    expect(addManualShoppingItem).not.toHaveBeenCalled();
  });

  it('rejects a name longer than 80 characters', async () => {
    const response = await itemsRoute.POST(postItem(JSON.stringify({ name: 'a'.repeat(81) })), params(PLAN_ID));

    expect(response.status).toBe(400);
    expect(addManualShoppingItem).not.toHaveBeenCalled();
  });

  it('rejects extra fields in the body', async () => {
    const response = await itemsRoute.POST(
      postItem('{"name":"latte","qty":2}'),
      params(PLAN_ID)
    );

    expect(response.status).toBe(400);
    expect(addManualShoppingItem).not.toHaveBeenCalled();
  });

  it('rejects a non-UUID plan id with 404 plan_not_found', async () => {
    const response = await itemsRoute.POST(postItem('{"name":"latte"}'), params('abc'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('plan_not_found');
    expect(addManualShoppingItem).not.toHaveBeenCalled();
  });

  it('maps list_not_found to 404', async () => {
    vi.mocked(addManualShoppingItem).mockRejectedValueOnce(new ShoppingError('list_not_found'));

    const response = await itemsRoute.POST(postItem('{"name":"latte"}'), params(PLAN_ID));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('list_not_found');
  });

  it('maps an unexpected error to 500 without leaking the message', async () => {
    vi.mocked(addManualShoppingItem).mockRejectedValueOnce(new Error('boom secret'));

    const response = await itemsRoute.POST(postItem('{"name":"latte"}'), params(PLAN_ID));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('boom');
  });

  it('returns the item id in the body under item', async () => {
    vi.mocked(addManualShoppingItem).mockResolvedValueOnce({ item: { id: ITEM_ID }, created: true } as never);

    const response = await itemsRoute.POST(postItem('{"name":"latte"}'), params(PLAN_ID));

    expect((await response.json()).item.id).toBe(ITEM_ID);
  });
});
