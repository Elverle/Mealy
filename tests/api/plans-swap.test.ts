// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as swapRoute from '@/app/api/plans/[id]/slots/[slotId]/swap/route';
import { LlmError } from '@/lib/llm/errors';
import { PLAN_ERROR_HTTP, PlanError } from '@/lib/plans/errors';
import { swapSlot } from '@/lib/plans/service';

vi.mock('@/lib/plans/service', () => ({
  swapSlot: vi.fn(),
}));

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const SLOT_ID = '22222222-2222-4222-8222-222222222222';
const RECIPE_ID = '33333333-3333-4333-8333-333333333333';
const MOCK_RESULT = { marker: 'from-service' };

function post(body?: string): Request {
  return new Request('http://localhost/x', { method: 'POST', body });
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

describe('POST /api/plans/:id/slots/:slotId/swap', () => {
  it('exports runtime, dynamic and maxDuration 200', () => {
    expect(swapRoute.runtime).toBe('nodejs');
    expect(swapRoute.dynamic).toBe('force-dynamic');
    expect(swapRoute.maxDuration).toBe(200);
  });

  it('returns 200 with the service result', async () => {
    vi.mocked(swapSlot).mockResolvedValueOnce(MOCK_RESULT as never);

    const response = await swapRoute.POST(
      post(JSON.stringify({ exclude_recipe_ids: [RECIPE_ID] })),
      params(PLAN_ID, SLOT_ID)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MOCK_RESULT);
    expect(swapSlot).toHaveBeenCalledWith(PLAN_ID, SLOT_ID, { exclude_recipe_ids: [RECIPE_ID] });
  });

  it('calls the service with an empty exclusion list for an empty body', async () => {
    vi.mocked(swapSlot).mockResolvedValueOnce(MOCK_RESULT as never);

    const response = await swapRoute.POST(post(), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(200);
    expect(swapSlot).toHaveBeenCalledWith(PLAN_ID, SLOT_ID, { exclude_recipe_ids: [] });
  });

  it.each([['{"exclude_recipe_ids":["x"]}'], ['{'], ['{"other":1}']])(
    'rejects the body %s with 400 invalid_request',
    async (body) => {
      const response = await swapRoute.POST(post(body), params(PLAN_ID, SLOT_ID));

      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('invalid_request');
      expect(swapSlot).not.toHaveBeenCalled();
    }
  );

  it('includes details for an invalid exclusion id', async () => {
    const response = await swapRoute.POST(
      post('{"exclude_recipe_ids":["x"]}'),
      params(PLAN_ID, SLOT_ID)
    );

    const { error } = await response.json();
    expect(error.details).toEqual([expect.objectContaining({ path: 'exclude_recipe_ids.0' })]);
  });

  it('returns 404 plan_not_found for a non-UUID plan id', async () => {
    const response = await swapRoute.POST(post(), params('x', SLOT_ID));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('plan_not_found');
    expect(swapSlot).not.toHaveBeenCalled();
  });

  it('returns 404 slot_not_found for a non-UUID slot id', async () => {
    const response = await swapRoute.POST(post(), params(PLAN_ID, 'x'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('slot_not_found');
  });

  it('maps PlanError(slot_locked) to 409 with the table message', async () => {
    vi.mocked(swapSlot).mockRejectedValueOnce(new PlanError('slot_locked'));

    const response = await swapRoute.POST(post(), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'slot_locked', message: PLAN_ERROR_HTTP.slot_locked.message },
    });
  });

  it('maps PlanError(no_alternatives) to 422', async () => {
    vi.mocked(swapSlot).mockRejectedValueOnce(new PlanError('no_alternatives'));

    const response = await swapRoute.POST(post(), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(422);
  });

  it('maps LlmError(provider) to 502 llm_unavailable', async () => {
    vi.mocked(swapSlot).mockRejectedValueOnce(new LlmError('provider', 'x'));

    const response = await swapRoute.POST(post(), params(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('llm_unavailable');
  });
});
