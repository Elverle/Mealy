// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as repeatRoute from '@/app/api/plans/[id]/repeat/route';
import { LlmError } from '@/lib/llm/errors';
import { PLAN_ERROR_HTTP, PlanError } from '@/lib/plans/errors';
import { repeatPlan } from '@/lib/plans/service';

vi.mock('@/lib/plans/service', () => ({
  repeatPlan: vi.fn(),
}));

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const MOCK_RESULT = { marker: 'from-service' };

function post(body?: string): Request {
  return new Request('http://localhost/x', { method: 'POST', body });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/plans/:id/repeat', () => {
  it('exports runtime, dynamic and maxDuration 200', () => {
    expect(repeatRoute.runtime).toBe('nodejs');
    expect(repeatRoute.dynamic).toBe('force-dynamic');
    expect(repeatRoute.maxDuration).toBe(200);
  });

  it('returns 200 with the service result and ignores the body', async () => {
    vi.mocked(repeatPlan).mockResolvedValueOnce(MOCK_RESULT as never);

    const response = await repeatRoute.POST(post('{"ignored":true}'), params(PLAN_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MOCK_RESULT);
    expect(repeatPlan).toHaveBeenCalledWith(PLAN_ID);
  });

  it('returns 404 plan_not_found for a non-UUID id without calling the service', async () => {
    const response = await repeatRoute.POST(post(), params('not-a-uuid'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('plan_not_found');
    expect(repeatPlan).not.toHaveBeenCalled();
  });

  it('maps PlanError(repeat_same_week) to 409 with the table message', async () => {
    vi.mocked(repeatPlan).mockRejectedValueOnce(new PlanError('repeat_same_week'));

    const response = await repeatRoute.POST(post(), params(PLAN_ID));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'repeat_same_week', message: PLAN_ERROR_HTTP.repeat_same_week.message },
    });
  });

  it('maps PlanError(plan_confirmed) to 409', async () => {
    vi.mocked(repeatPlan).mockRejectedValueOnce(new PlanError('plan_confirmed'));

    const response = await repeatRoute.POST(post(), params(PLAN_ID));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('plan_confirmed');
  });

  it('maps LlmError(timeout) to 504 llm_timeout', async () => {
    vi.mocked(repeatPlan).mockRejectedValueOnce(new LlmError('timeout', 'slow'));

    const response = await repeatRoute.POST(post(), params(PLAN_ID));

    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe('llm_timeout');
  });

  it('maps an unexpected error to 500 internal_error without leaking the message', async () => {
    vi.mocked(repeatPlan).mockRejectedValueOnce(new Error('boom secret'));

    const response = await repeatRoute.POST(post(), params(PLAN_ID));

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('boom');
    expect(JSON.parse(text).error.code).toBe('internal_error');
  });
});
