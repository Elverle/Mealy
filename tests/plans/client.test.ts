import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  PlanRequestError,
  fetchPlanScreen,
  fetchSlotCandidates,
  requestAssignSlotRecipe,
  requestConfirmPlan,
  requestGeneratePlan,
  requestRepeatPlan,
  requestSlotLock,
  requestSwapSlot,
} from '@/lib/plans/client';
import { ApiRequestError } from '@/lib/http/client';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const SLOT_ID = '22222222-2222-4222-8222-222222222222';
const TARGET = { week_start: '2026-09-28', first_day: '2026-09-30', last_day: '2026-10-04' };

const SCREEN = {
  today: '2026-09-30',
  current_week_start: '2026-09-28',
  target: TARGET,
  view: { week: TARGET, plan: null, action: 'generate', editable: false, can_repeat: false },
  prev_week_start: null,
  next_week_start: null,
  target_plan_status: null,
  current_plan_id: null,
};

const PLAN = {
  id: PLAN_ID,
  week_start: '2026-09-28',
  status: 'draft',
  created_at: '2026-09-30T10:00:00.000Z',
  generated_at: '2026-09-30T10:00:00.000Z',
  superseded: false,
  slots: [],
  shopping_list: { exists: false, needs_regeneration: false },
};

const GENERATION = { rounds: 0, created: 0, failed: false };

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

describe('plan client requests', () => {
  it('fetchPlanScreen GETs /api/plans/current without a query by default', async () => {
    const fetchMock = stubFetch(jsonResponse(200, SCREEN));

    await expect(fetchPlanScreen()).resolves.toEqual(SCREEN);

    expect(fetchMock.mock.calls[0][0]).toBe('/api/plans/current');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');
  });

  it('fetchPlanScreen adds ?settimana= when a week is given', async () => {
    const fetchMock = stubFetch(jsonResponse(200, SCREEN));

    await fetchPlanScreen('2026-09-21');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/plans/current?settimana=2026-09-21');
  });

  it('requestGeneratePlan POSTs /api/plans with an empty JSON object', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { screen: SCREEN, generation: GENERATION }));

    await expect(requestGeneratePlan()).resolves.toEqual({
      screen: SCREEN,
      generation: GENERATION,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/plans');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('requestConfirmPlan POSTs /api/plans/{id}/confirm without a body', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { plan: PLAN }));

    await expect(requestConfirmPlan(PLAN_ID)).resolves.toEqual({ plan: PLAN });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/plans/${PLAN_ID}/confirm`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('requestSlotLock PATCHes the slot with { locked }', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { plan: PLAN }));

    await requestSlotLock(PLAN_ID, SLOT_ID, true);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/plans/${PLAN_ID}/slots/${SLOT_ID}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ locked: true });
  });

  it('requestSwapSlot POSTs the exclude list to the swap route', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { plan: PLAN, generation: GENERATION }));

    await expect(requestSwapSlot(PLAN_ID, SLOT_ID, ['a', 'b'])).resolves.toEqual({
      plan: PLAN,
      generation: GENERATION,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/plans/${PLAN_ID}/slots/${SLOT_ID}/swap`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ exclude_recipe_ids: ['a', 'b'] });
  });

  it('requestRepeatPlan POSTs /api/plans/{id}/repeat without a body', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { screen: SCREEN, generation: GENERATION }));

    await expect(requestRepeatPlan(PLAN_ID)).resolves.toEqual({
      screen: SCREEN,
      generation: GENERATION,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/plans/${PLAN_ID}/repeat`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });
});

describe('plan client errors', () => {
  it('maps a 422 { error } body to a PlanRequestError with that status, code and message', async () => {
    stubFetch(
      jsonResponse(422, {
        error: { code: 'no_alternatives', message: 'Non ci sono altre ricette adatte a questo pasto.' },
      })
    );

    const error = await requestSwapSlot(PLAN_ID, SLOT_ID, []).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlanRequestError);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      name: 'PlanRequestError',
      status: 422,
      code: 'no_alternatives',
      message: 'Non ci sono altre ricette adatte a questo pasto.',
    });
  });

  it('throws network_error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    const error = await requestGeneratePlan().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlanRequestError);
    expect(error).toMatchObject({ status: 0, code: 'network_error' });
  });

  it('throws invalid_response on a 200 with a non-conforming body', async () => {
    stubFetch(jsonResponse(200, { nonsense: true }));

    const error = await fetchPlanScreen().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlanRequestError);
    expect(error).toMatchObject({ status: 200, code: 'invalid_response' });
  });
});

const RECIPE_ID = '33333333-3333-4333-8333-333333333333';

describe('slot recipe choice requests', () => {
  it('fetchSlotCandidates GETs the candidates of the slot and parses them', async () => {
    const candidates = { recipes: [], in_plan_recipe_ids: [RECIPE_ID] };
    const fetchMock = stubFetch(jsonResponse(200, candidates));

    await expect(fetchSlotCandidates(PLAN_ID, SLOT_ID)).resolves.toEqual(candidates);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/plans/${PLAN_ID}/slots/${SLOT_ID}/candidates`);
    expect(init.method).toBe('GET');
  });

  it('requestAssignSlotRecipe PUTs the recipe id to the slot and returns the plan', async () => {
    const fetchMock = stubFetch(jsonResponse(200, { plan: PLAN }));

    await expect(requestAssignSlotRecipe(PLAN_ID, SLOT_ID, RECIPE_ID)).resolves.toEqual({ plan: PLAN });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/plans/${PLAN_ID}/slots/${SLOT_ID}/recipe`);
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ recipe_id: RECIPE_ID }));
  });

  it('maps a 422 recipe_not_eligible to a PlanRequestError', async () => {
    stubFetch(
      jsonResponse(422, {
        error: { code: 'recipe_not_eligible', message: 'Questa ricetta non è adatta a questo pasto.' },
      })
    );

    const error = await requestAssignSlotRecipe(PLAN_ID, SLOT_ID, RECIPE_ID).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlanRequestError);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({
      status: 422,
      code: 'recipe_not_eligible',
      message: 'Questa ricetta non è adatta a questo pasto.',
    });
  });
});
