import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  deleteShoppingItem,
  fetchPlanShoppingList,
  patchShoppingItem,
  postShoppingItem,
  requestBuildShoppingList,
} from '@/lib/shopping/client';
import { ApiRequestError } from '@/lib/http/client';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const LIST_ID = '66666666-6666-4666-8666-666666666666';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const MANUAL_ITEM_ID = '44444444-4444-4444-8444-444444444444';
const RECIPE_ID = '55555555-5555-4555-8555-555555555555';

const ITEM = {
  id: ITEM_ID,
  canonical_name: 'pasta',
  qty: 500,
  unit: 'g',
  category: 'dispensa',
  checked: true,
  manual: false,
  recipe_ids: [RECIPE_ID],
};

const MANUAL_ITEM = {
  id: MANUAL_ITEM_ID,
  canonical_name: 'carta forno',
  qty: null,
  unit: null,
  category: 'altro',
  checked: false,
  manual: true,
  recipe_ids: [],
};

const VIEW = {
  plan: {
    id: PLAN_ID,
    week_start: '2026-09-28',
    last_day: '2026-10-04',
    status: 'active',
    has_list: true,
  },
  editable: true,
  can_build: true,
  list: {
    id: LIST_ID,
    generated_at: '2026-09-30T10:00:00.000Z',
    needs_regeneration: false,
    items: [ITEM],
    recipes: [{ id: RECIPE_ID, title: 'Pasta al pomodoro' }],
  },
};

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

describe('shopping list client requests', () => {
  it('fetchPlanShoppingList GETs /api/plans/{planId}/shopping-list', async () => {
    const fetchMock = stubFetch(jsonResponse(200, VIEW));

    await expect(fetchPlanShoppingList(PLAN_ID)).resolves.toEqual(VIEW);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/plans/${PLAN_ID}/shopping-list`);
    expect(init.method).toBe('GET');
  });

  it('requestBuildShoppingList POSTs the same path without a body', async () => {
    const fetchMock = stubFetch(jsonResponse(200, VIEW));

    await expect(requestBuildShoppingList(PLAN_ID)).resolves.toEqual(VIEW);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/plans/${PLAN_ID}/shopping-list`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('patchShoppingItem PATCHes the item with { checked } and returns the item', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { item: ITEM }));

    await expect(patchShoppingItem(ITEM_ID, true)).resolves.toEqual(ITEM);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/shopping-items/${ITEM_ID}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ checked: true });
  });

  it('patchShoppingItem passes the given signal to fetch', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { item: ITEM }));
    const controller = new AbortController();

    await patchShoppingItem(ITEM_ID, true, controller.signal);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it('patchShoppingItem without a signal does not pass one to fetch', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { item: ITEM }));

    await patchShoppingItem(ITEM_ID, false);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeUndefined();
  });

  it('postShoppingItem POSTs { name } to the items route and returns the item', async () => {
    const fetchMock = stubFetch(jsonResponse(201, { item: MANUAL_ITEM }));

    await expect(postShoppingItem(PLAN_ID, 'carta forno')).resolves.toEqual(MANUAL_ITEM);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/plans/${PLAN_ID}/shopping-list/items`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'carta forno' });
  });

  it('postShoppingItem accepts a 200 response for an item already on the list', async () => {
    stubFetch(jsonResponse(200, { item: ITEM }));

    await expect(postShoppingItem(PLAN_ID, 'pasta')).resolves.toEqual(ITEM);
  });

  it('deleteShoppingItem DELETEs the item and resolves with undefined', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { id: MANUAL_ITEM_ID }));

    await expect(deleteShoppingItem(MANUAL_ITEM_ID)).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/shopping-items/${MANUAL_ITEM_ID}`);
    expect(init.method).toBe('DELETE');
  });

  it('encodes ids in the paths', async () => {
    const fetchMock = stubFetch(jsonResponse(200, VIEW));

    await fetchPlanShoppingList('a/b c');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/plans/a%2Fb%20c/shopping-list');
  });
});

describe('shopping list client errors', () => {
  it('maps a 409 { error } body to an ApiRequestError with that status, code and message', async () => {
    stubFetch(
      jsonResponse(409, {
        error: { code: 'plan_archived', message: 'Il piano è chiuso.' },
      })
    );

    const error = await patchShoppingItem(ITEM_ID, true).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 409,
      code: 'plan_archived',
      message: 'Il piano è chiuso.',
    });
  });

  it('throws network_error with status 0 when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    const error = await deleteShoppingItem(ITEM_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 0, code: 'network_error' });
  });

  it('throws network_error when the request is aborted through its signal', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        controller.abort();
        return Promise.reject(new DOMException('Aborted', 'AbortError'));
      })
    );

    const error = await patchShoppingItem(ITEM_ID, true, controller.signal).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 0, code: 'network_error' });
  });
});
