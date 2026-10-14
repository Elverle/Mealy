// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as candidatesRoute from '@/app/api/plans/[id]/slots/[slotId]/candidates/route';
import * as recipeRoute from '@/app/api/plans/[id]/slots/[slotId]/recipe/route';
import { LlmError } from '@/lib/llm/errors';
import { PLAN_ERROR_HTTP, PlanError } from '@/lib/plans/errors';
import { assignSlotRecipe, listSlotCandidates } from '@/lib/plans/service';

vi.mock('@/lib/plans/service', () => ({
  listSlotCandidates: vi.fn(),
  assignSlotRecipe: vi.fn(),
}));

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const SLOT_ID = '22222222-2222-4222-8222-222222222222';
const RECIPE_ID = '33333333-3333-4333-8333-333333333333';
const MOCK_RESULT = { marker: 'from-service' };

function put(body?: string): Request {
  return new Request('http://localhost/x', { method: 'PUT', body });
}

function get(): Request {
  return new Request('http://localhost/x', { method: 'GET' });
}

function params(id: string, slotId: string) {
  return { params: Promise.resolve({ id, slotId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/plans/:id/slots/:slotId/candidates', () => {
  it('exports runtime and dynamic', () => {
    expect(candidatesRoute.runtime).toBe('nodejs');
    expect(candidatesRoute.dynamic).toBe('force-dynamic');
  });

  it('returns 200 with the service result, called with plan and slot ids', async () => {
    vi.mocked(listSlotCandidates).mockResolvedValueOnce(MOCK_RESULT as never);

    const response = await candidatesRoute.GET(get(), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MOCK_RESULT);
    expect(listSlotCandidates).toHaveBeenCalledWith(PLAN_ID, SLOT_ID);
  });

  it('returns 404 plan_not_found for a non-UUID plan id, without calling the service', async () => {
    const response = await candidatesRoute.GET(get(), params('x', SLOT_ID));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('plan_not_found');
    expect(listSlotCandidates).not.toHaveBeenCalled();
  });

  it('returns 404 slot_not_found for a non-UUID slot id, without calling the service', async () => {
    const response = await candidatesRoute.GET(get(), params(PLAN_ID, 'x'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('slot_not_found');
    expect(listSlotCandidates).not.toHaveBeenCalled();
  });

  it('maps PlanError(slot_locked) to 409 with the table message', async () => {
    vi.mocked(listSlotCandidates).mockRejectedValueOnce(new PlanError('slot_locked'));

    const response = await candidatesRoute.GET(get(), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'slot_locked', message: PLAN_ERROR_HTTP.slot_locked.message },
    });
  });

  it('maps PlanError(plan_archived) to 409', async () => {
    vi.mocked(listSlotCandidates).mockRejectedValueOnce(new PlanError('plan_archived'));

    const response = await candidatesRoute.GET(get(), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('plan_archived');
  });

  it('maps an unexpected error to 500 internal_error without leaking its message', async () => {
    vi.mocked(listSlotCandidates).mockRejectedValueOnce(new Error('dettaglio interno'));

    const response = await candidatesRoute.GET(get(), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe('internal_error');
    expect(JSON.stringify(body)).not.toContain('dettaglio interno');
  });
});

describe('PUT /api/plans/:id/slots/:slotId/recipe', () => {
  const validBody = JSON.stringify({ recipe_id: RECIPE_ID });

  it('exports runtime and dynamic', () => {
    expect(recipeRoute.runtime).toBe('nodejs');
    expect(recipeRoute.dynamic).toBe('force-dynamic');
  });

  it('returns 200 with the service result, called with plan, slot and recipe ids', async () => {
    vi.mocked(assignSlotRecipe).mockResolvedValueOnce(MOCK_RESULT as never);

    const response = await recipeRoute.PUT(put(validBody), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MOCK_RESULT);
    expect(assignSlotRecipe).toHaveBeenCalledWith(PLAN_ID, SLOT_ID, RECIPE_ID);
  });

  it.each([
    ['empty body', undefined],
    ['malformed JSON', '{'],
    ['missing recipe_id', '{"recipe_id":"x"}'],
    ['extra field', JSON.stringify({ recipe_id: RECIPE_ID, x: 1 })],
  ])('rejects %s with 400 invalid_request, without calling the service', async (_label, body) => {
    const response = await recipeRoute.PUT(put(body), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
    expect(assignSlotRecipe).not.toHaveBeenCalled();
  });

  it('returns 404 plan_not_found for a non-UUID plan id, without calling the service', async () => {
    const response = await recipeRoute.PUT(put(validBody), params('x', SLOT_ID));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('plan_not_found');
    expect(assignSlotRecipe).not.toHaveBeenCalled();
  });

  it('returns 404 slot_not_found for a non-UUID slot id, without calling the service', async () => {
    const response = await recipeRoute.PUT(put(validBody), params(PLAN_ID, 'x'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('slot_not_found');
    expect(assignSlotRecipe).not.toHaveBeenCalled();
  });

  it('maps PlanError(recipe_not_found) to 404 with the table message', async () => {
    vi.mocked(assignSlotRecipe).mockRejectedValueOnce(new PlanError('recipe_not_found'));

    const response = await recipeRoute.PUT(put(validBody), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'recipe_not_found', message: 'Ricetta non trovata.' },
    });
  });

  it('maps PlanError(recipe_not_eligible) to 422 with the table message', async () => {
    vi.mocked(assignSlotRecipe).mockRejectedValueOnce(new PlanError('recipe_not_eligible'));

    const response = await recipeRoute.PUT(put(validBody), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: 'recipe_not_eligible',
        message: 'Questa ricetta non è adatta a questo pasto.',
      },
    });
  });

  it('maps PlanError(slot_past) to 409', async () => {
    vi.mocked(assignSlotRecipe).mockRejectedValueOnce(new PlanError('slot_past'));

    const response = await recipeRoute.PUT(put(validBody), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'slot_past', message: 'Questo pasto è già passato.' },
    });
  });

  it('maps LlmError(provider) to 502 llm_unavailable, as the other plan routes do', async () => {
    vi.mocked(assignSlotRecipe).mockRejectedValueOnce(new LlmError('provider', 'x'));

    const response = await recipeRoute.PUT(put(validBody), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('llm_unavailable');
  });
});
