// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as plansRoute from '@/app/api/plans/route';
import * as currentRoute from '@/app/api/plans/current/route';
import * as confirmRoute from '@/app/api/plans/[id]/confirm/route';
import * as slotRoute from '@/app/api/plans/[id]/slots/[slotId]/route';
import { LlmError } from '@/lib/llm/errors';
import { PLAN_ERROR_CODES, PLAN_ERROR_HTTP, PlanError } from '@/lib/plans/errors';
import { confirmPlan, generatePlan, getPlanScreen, setSlotLock } from '@/lib/plans/service';

vi.mock('@/lib/plans/service', () => ({
  getPlanScreen: vi.fn(),
  generatePlan: vi.fn(),
  confirmPlan: vi.fn(),
  setSlotLock: vi.fn(),
}));

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const SLOT_ID = '22222222-2222-4222-8222-222222222222';
const MOCK_RESULT = { marker: 'from-service' };

function post(body?: string): Request {
  return new Request('http://localhost/api/plans', { method: 'POST', body });
}

function confirmParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function slotParams(id: string, slotId: string) {
  return { params: Promise.resolve({ id, slotId }) };
}

function patch(body: string): Request {
  return new Request('http://localhost/x', { method: 'PATCH', body });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/plans/current', () => {
  it('exports runtime and dynamic', () => {
    expect(currentRoute.runtime).toBe('nodejs');
    expect(currentRoute.dynamic).toBe('force-dynamic');
  });

  it('returns 200 with the service value and no week by default', async () => {
    vi.mocked(getPlanScreen).mockResolvedValueOnce(MOCK_RESULT as never);

    const response = await currentRoute.GET(new Request('http://localhost/api/plans/current'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MOCK_RESULT);
    expect(getPlanScreen).toHaveBeenCalledWith({ week: undefined });
  });

  it('forwards ?settimana= to the service as week', async () => {
    vi.mocked(getPlanScreen).mockResolvedValueOnce(MOCK_RESULT as never);

    await currentRoute.GET(new Request('http://localhost/api/plans/current?settimana=2026-09-21'));

    expect(getPlanScreen).toHaveBeenCalledWith({ week: '2026-09-21' });
  });

  it('maps an unexpected error to 500 internal_error without leaking the message', async () => {
    vi.mocked(getPlanScreen).mockRejectedValueOnce(new Error('boom secret'));

    const response = await currentRoute.GET(new Request('http://localhost/api/plans/current'));

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('boom');
    expect(JSON.parse(text).error.code).toBe('internal_error');
  });
});

describe('POST /api/plans', () => {
  it('exports runtime, dynamic and maxDuration 300', () => {
    expect(plansRoute.runtime).toBe('nodejs');
    expect(plansRoute.dynamic).toBe('force-dynamic');
    expect(plansRoute.maxDuration).toBe(300);
  });

  it('calls the service with an empty body and returns 200', async () => {
    vi.mocked(generatePlan).mockResolvedValueOnce(MOCK_RESULT as never);

    const response = await plansRoute.POST(post());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MOCK_RESULT);
    expect(generatePlan).toHaveBeenCalledTimes(1);
  });

  it('accepts an explicit empty JSON object', async () => {
    vi.mocked(generatePlan).mockResolvedValueOnce(MOCK_RESULT as never);

    const response = await plansRoute.POST(post('{}'));

    expect(response.status).toBe(200);
  });

  it.each([['{'], ['{"week_start":"x"}']])('rejects the body %s with 400 invalid_request', async (body) => {
    const response = await plansRoute.POST(post(body));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
    expect(generatePlan).not.toHaveBeenCalled();
  });

  it('maps LlmError(timeout) to 504 llm_timeout', async () => {
    vi.mocked(generatePlan).mockRejectedValueOnce(new LlmError('timeout', 'slow'));

    const response = await plansRoute.POST(post());

    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe('llm_timeout');
  });

  it('maps an unexpected error to 500 internal_error without leaking the message', async () => {
    vi.mocked(generatePlan).mockRejectedValueOnce(new Error('boom'));

    const response = await plansRoute.POST(post());

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('boom');
    expect(JSON.parse(text).error.code).toBe('internal_error');
  });

  it.each(PLAN_ERROR_CODES)('maps PlanError(%s) to the table status, code and message', async (code) => {
    vi.mocked(generatePlan).mockRejectedValueOnce(new PlanError(code));

    const response = await plansRoute.POST(post());

    expect(response.status).toBe(PLAN_ERROR_HTTP[code].status);
    expect(await response.json()).toEqual({
      error: { code, message: PLAN_ERROR_HTTP[code].message },
    });
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('POST /api/plans/:id/confirm', () => {
  it('exports runtime and dynamic', () => {
    expect(confirmRoute.runtime).toBe('nodejs');
    expect(confirmRoute.dynamic).toBe('force-dynamic');
  });

  it('confirms the plan and returns 200', async () => {
    vi.mocked(confirmPlan).mockResolvedValueOnce(MOCK_RESULT as never);

    const response = await confirmRoute.POST(post(), confirmParams(PLAN_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MOCK_RESULT);
    expect(confirmPlan).toHaveBeenCalledWith(PLAN_ID);
  });

  it('returns 404 plan_not_found for a non-UUID id without calling the service', async () => {
    const response = await confirmRoute.POST(post(), confirmParams('not-a-uuid'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('plan_not_found');
    expect(confirmPlan).not.toHaveBeenCalled();
  });

  it('maps a PlanError from the service (plan_archived -> 409)', async () => {
    vi.mocked(confirmPlan).mockRejectedValueOnce(new PlanError('plan_archived'));

    const response = await confirmRoute.POST(post(), confirmParams(PLAN_ID));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('plan_archived');
  });
});

describe('PATCH /api/plans/:id/slots/:slotId', () => {
  it('exports runtime and dynamic', () => {
    expect(slotRoute.runtime).toBe('nodejs');
    expect(slotRoute.dynamic).toBe('force-dynamic');
  });

  it('sets the lock and returns 200', async () => {
    vi.mocked(setSlotLock).mockResolvedValueOnce(MOCK_RESULT as never);

    const response = await slotRoute.PATCH(patch('{"locked":true}'), slotParams(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MOCK_RESULT);
    expect(setSlotLock).toHaveBeenCalledWith(PLAN_ID, SLOT_ID, true);
  });

  it('returns 404 plan_not_found for a non-UUID plan id', async () => {
    const response = await slotRoute.PATCH(patch('{"locked":true}'), slotParams('x', SLOT_ID));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('plan_not_found');
  });

  it('returns 404 slot_not_found for a non-UUID slot id', async () => {
    const response = await slotRoute.PATCH(patch('{"locked":true}'), slotParams(PLAN_ID, 'x'));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('slot_not_found');
  });

  it.each([[''], ['{'], ['{"locked":"si"}'], ['{"locked":true,"x":1}']])(
    'rejects the body %j with 400 invalid_request',
    async (body) => {
      const response = await slotRoute.PATCH(patch(body), slotParams(PLAN_ID, SLOT_ID));

      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('invalid_request');
      expect(setSlotLock).not.toHaveBeenCalled();
    }
  );

  it('maps a PlanError from the service (slot_not_found -> 404)', async () => {
    vi.mocked(setSlotLock).mockRejectedValueOnce(new PlanError('slot_not_found'));

    const response = await slotRoute.PATCH(patch('{"locked":false}'), slotParams(PLAN_ID, SLOT_ID));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('slot_not_found');
  });
});
