// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as sideRoute from '@/app/api/plans/[id]/slots/[slotId]/side/route';
import * as slotRoute from '@/app/api/plans/[id]/slots/[slotId]/route';
import { LlmError } from '@/lib/llm/errors';
import { PLAN_ERROR_HTTP, PlanError } from '@/lib/plans/errors';
import { addSideDish, removeSideDish } from '@/lib/plans/service';

vi.mock('@/lib/plans/service', () => ({
  addSideDish: vi.fn(),
  removeSideDish: vi.fn(),
  setSlotLock: vi.fn(),
}));

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const SLOT_ID = '22222222-2222-4222-8222-222222222222';
const RECIPE_ID = '33333333-3333-4333-8333-333333333333';
const MOCK_RESULT = { marker: 'from-service' };

function post(body?: string): Request {
  return new Request('http://localhost/x', { method: 'POST', body });
}

function del(): Request {
  return new Request('http://localhost/x', { method: 'DELETE' });
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

describe('POST /api/plans/:id/slots/:slotId/side', () => {
  it('exports runtime, dynamic and maxDuration 250', () => {
    expect(sideRoute.runtime).toBe('nodejs');
    expect(sideRoute.dynamic).toBe('force-dynamic');
    expect(sideRoute.maxDuration).toBe(250);
  });

  it('returns 200 with the service result and passes the exclusions to addSideDish', async () => {
    vi.mocked(addSideDish).mockResolvedValueOnce(MOCK_RESULT as never);

    const response = await sideRoute.POST(
      post(JSON.stringify({ exclude_recipe_ids: [RECIPE_ID] })),
      params(PLAN_ID, SLOT_ID)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MOCK_RESULT);
    expect(addSideDish).toHaveBeenCalledWith(PLAN_ID, SLOT_ID, { exclude_recipe_ids: [RECIPE_ID] });
  });

  it('accepts an empty body and calls the service with no exclusions', async () => {
    vi.mocked(addSideDish).mockResolvedValueOnce(MOCK_RESULT as never);

    const response = await sideRoute.POST(post(), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(200);
    expect(addSideDish).toHaveBeenCalledWith(PLAN_ID, SLOT_ID, { exclude_recipe_ids: [] });
  });

  it('rejects an invalid body with 400 invalid_request', async () => {
    const response = await sideRoute.POST(post('{"other":1}'), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
    expect(addSideDish).not.toHaveBeenCalled();
  });

  it('returns 404 plan_not_found and slot_not_found for non-UUID ids', async () => {
    const badPlan = await sideRoute.POST(post(), params('x', SLOT_ID));
    expect(badPlan.status).toBe(404);
    expect((await badPlan.json()).error.code).toBe('plan_not_found');

    const badSlot = await sideRoute.POST(post(), params(PLAN_ID, 'x'));
    expect(badSlot.status).toBe(404);
    expect((await badSlot.json()).error.code).toBe('slot_not_found');
    expect(addSideDish).not.toHaveBeenCalled();
  });

  it('maps PlanError(side_exists) to 409 with the table message', async () => {
    vi.mocked(addSideDish).mockRejectedValueOnce(new PlanError('side_exists'));

    const response = await sideRoute.POST(post(), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'side_exists', message: PLAN_ERROR_HTTP.side_exists.message },
    });
    expect(PLAN_ERROR_HTTP.side_exists.message).toBe('Questo pasto ha già un contorno.');
  });

  it('maps PlanError(no_alternatives) to 422', async () => {
    vi.mocked(addSideDish).mockRejectedValueOnce(new PlanError('no_alternatives'));

    const response = await sideRoute.POST(post(), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(422);
  });

  it('maps LlmError(provider) to 502 llm_unavailable', async () => {
    vi.mocked(addSideDish).mockRejectedValueOnce(new LlmError('provider', 'x'));

    const response = await sideRoute.POST(post(), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('llm_unavailable');
  });
});

describe('DELETE /api/plans/:id/slots/:slotId', () => {
  it('returns 200 with the service result when a contorno is removed', async () => {
    vi.mocked(removeSideDish).mockResolvedValueOnce(MOCK_RESULT as never);

    const response = await slotRoute.DELETE(del(), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MOCK_RESULT);
    expect(removeSideDish).toHaveBeenCalledWith(PLAN_ID, SLOT_ID);
  });

  it('returns 409 not_a_side_dish with the table message for a main dish', async () => {
    vi.mocked(removeSideDish).mockRejectedValueOnce(new PlanError('not_a_side_dish'));

    const response = await slotRoute.DELETE(del(), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'not_a_side_dish', message: 'Si può togliere solo il contorno.' },
    });
  });

  it('returns 404 for non-UUID ids without calling the service', async () => {
    const badPlan = await slotRoute.DELETE(del(), params('x', SLOT_ID));
    expect((await badPlan.json()).error.code).toBe('plan_not_found');

    const badSlot = await slotRoute.DELETE(del(), params(PLAN_ID, 'x'));
    expect(badSlot.status).toBe(404);
    expect((await badSlot.json()).error.code).toBe('slot_not_found');
    expect(removeSideDish).not.toHaveBeenCalled();
  });
});
