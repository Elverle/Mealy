// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as proposeRoute from '@/app/api/recipes/propose/route';
import { LlmError } from '@/lib/llm/errors';
import { RECIPE_ERROR_HTTP, RecipeError } from '@/lib/recipes/errors';
import { proposeRecipe } from '@/lib/recipes/propose';

vi.mock('@/lib/recipes/propose', () => ({
  proposeRecipe: vi.fn(),
  saveProposedRecipe: vi.fn(),
}));

const MOCK_PROPOSAL = { recipe: { title: 'Lasagne al pesto' }, duplicate_of: null };

function post(body?: string, signal?: AbortSignal): Request {
  return new Request('http://localhost/api/recipes/propose', {
    method: 'POST',
    body,
    signal,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/recipes/propose', () => {
  it('exports runtime, dynamic and maxDuration 250', () => {
    expect(proposeRoute.runtime).toBe('nodejs');
    expect(proposeRoute.dynamic).toBe('force-dynamic');
    expect(proposeRoute.maxDuration).toBe(250);
  });

  it('returns 200 with the service proposal and passes the request signal to the service', async () => {
    vi.mocked(proposeRecipe).mockResolvedValueOnce(MOCK_PROPOSAL as never);
    const request = post(JSON.stringify({ request: 'lasagne' }));

    const response = await proposeRoute.POST(request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(MOCK_PROPOSAL);
    expect(proposeRecipe).toHaveBeenCalledWith(
      { request: 'lasagne', mealType: null, excludeTitles: [] },
      { abortSignal: request.signal }
    );
  });

  it('maps meal_type and exclude_titles to mealType and excludeTitles, and trims the request', async () => {
    vi.mocked(proposeRecipe).mockResolvedValueOnce(MOCK_PROPOSAL as never);

    await proposeRoute.POST(
      post(JSON.stringify({ request: '  lasagne  ', meal_type: 'cena', exclude_titles: ['A'] }))
    );

    expect(proposeRecipe).toHaveBeenCalledWith(
      { request: 'lasagne', mealType: 'cena', excludeTitles: ['A'] },
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) })
    );
  });

  it.each([
    ['an empty body', undefined],
    ['a malformed JSON body', '{'],
    ['a request shorter than the minimum', JSON.stringify({ request: 'ab' })],
    ['a request longer than the maximum', JSON.stringify({ request: 'a'.repeat(101) })],
    ['an unknown key', JSON.stringify({ request: 'abc', x: 1 })],
    ['an invalid meal_type', JSON.stringify({ request: 'abc', meal_type: 'colazione' })],
    [
      'eleven excluded titles',
      JSON.stringify({ request: 'abc', exclude_titles: Array.from({ length: 11 }, (_, i) => `T${i}`) }),
    ],
  ])('rejects %s with 400 invalid_request without calling the service', async (_label, body) => {
    const response = await proposeRoute.POST(post(body));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_request');
    expect(proposeRecipe).not.toHaveBeenCalled();
  });

  it('maps RecipeError(proposal_unsuitable) to 422 with the table message', async () => {
    vi.mocked(proposeRecipe).mockRejectedValueOnce(new RecipeError('proposal_unsuitable'));

    const response = await proposeRoute.POST(post(JSON.stringify({ request: 'lasagne' })));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: 'proposal_unsuitable',
        message: RECIPE_ERROR_HTTP.proposal_unsuitable.message,
      },
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('maps LlmError(config) to 500 llm_not_configured', async () => {
    vi.mocked(proposeRecipe).mockRejectedValueOnce(new LlmError('config', 'x'));

    const response = await proposeRoute.POST(post(JSON.stringify({ request: 'lasagne' })));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: 'llm_not_configured',
        message: 'Generazione non disponibile: il modello non è configurato.',
      },
    });
  });

  it('maps LlmError(timeout) to 504 llm_timeout', async () => {
    vi.mocked(proposeRecipe).mockRejectedValueOnce(new LlmError('timeout', 'x'));

    const response = await proposeRoute.POST(post(JSON.stringify({ request: 'lasagne' })));

    expect(response.status).toBe(504);
    expect((await response.json()).error.code).toBe('llm_timeout');
  });

  it('maps LlmError(provider) to 502 llm_unavailable', async () => {
    vi.mocked(proposeRecipe).mockRejectedValueOnce(new LlmError('provider', 'x'));

    const response = await proposeRoute.POST(post(JSON.stringify({ request: 'lasagne' })));

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('llm_unavailable');
  });

  it('maps LlmError(invalid_output) to 502 llm_invalid_output', async () => {
    vi.mocked(proposeRecipe).mockRejectedValueOnce(new LlmError('invalid_output', 'x'));

    const response = await proposeRoute.POST(post(JSON.stringify({ request: 'lasagne' })));

    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('llm_invalid_output');
  });

  it('maps an unexpected error to 500 internal_error without leaking the message', async () => {
    vi.mocked(proposeRecipe).mockRejectedValueOnce(new Error('secret boom'));

    const response = await proposeRoute.POST(post(JSON.stringify({ request: 'lasagne' })));

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain('internal_error');
    expect(text).not.toContain('secret boom');
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('answers 499 without logging when the client aborted the request (R1: cancellation is not a timeout)', async () => {
    vi.mocked(proposeRecipe).mockRejectedValueOnce(new LlmError('timeout', 'x'));
    const controller = new AbortController();
    controller.abort();

    const response = await proposeRoute.POST(
      post(JSON.stringify({ request: 'lasagne' }), controller.signal)
    );

    expect(response.status).toBe(499);
    expect(console.error).not.toHaveBeenCalled();
  });
});
