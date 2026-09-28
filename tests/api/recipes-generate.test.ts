// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmError } from '@/lib/llm/errors';
import { POST, runtime, dynamic, maxDuration } from '@/app/api/recipes/generate/route';

vi.mock('@/lib/recipes', () => ({
  generateAndStoreRecipes: vi.fn(),
}));

describe('POST /api/recipes/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports correct route segment configurations', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
    expect(maxDuration).toBe(120);
  });

  it('returns 400 invalid_request on malformed JSON body', async () => {
    const request = new Request('http://localhost/api/recipes/generate', {
      method: 'POST',
      body: '{ malformed json',
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data).toEqual({
      error: {
        code: 'invalid_request',
        message: 'Richiesta non valida.',
      },
    });
  });

  it('returns 400 with details when count is out of bounds (count: 0)', async () => {
    const request = new Request('http://localhost/api/recipes/generate', {
      method: 'POST',
      body: JSON.stringify({ count: 0 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error.code).toBe('invalid_request');
    expect(data.error.message).toBe('Richiesta non valida.');
    expect(Array.isArray(data.error.details)).toBe(true);
    expect(data.error.details.length).toBeGreaterThan(0);
    expect(data.error.details[0].path).toBe('count');
  });

  it('returns 400 with details when count is out of bounds (count: 11)', async () => {
    const request = new Request('http://localhost/api/recipes/generate', {
      method: 'POST',
      body: JSON.stringify({ count: 11 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error.code).toBe('invalid_request');
    expect(data.error.details[0].path).toBe('count');
  });

  it('returns 400 with details when extra unexpected properties are passed', async () => {
    const request = new Request('http://localhost/api/recipes/generate', {
      method: 'POST',
      body: JSON.stringify({ foo: 1 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error.code).toBe('invalid_request');
    expect(data.error.details.length).toBeGreaterThan(0);
  });

  it('applies defaults when given an empty JSON body and calls service with defaults', async () => {
    const { generateAndStoreRecipes } = await import('@/lib/recipes');
    const mockResult = {
      requested: 5,
      created: [],
      skipped: [],
    };
    vi.mocked(generateAndStoreRecipes).mockResolvedValueOnce(mockResult);

    const request = new Request('http://localhost/api/recipes/generate', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual(mockResult);

    expect(generateAndStoreRecipes).toHaveBeenCalledWith({
      count: 5,
      mealType: null,
      overrides: {},
    });
  });

  it('forwards custom parameters correctly to generateAndStoreRecipes', async () => {
    const { generateAndStoreRecipes } = await import('@/lib/recipes');
    const mockResult = {
      requested: 3,
      created: [],
      skipped: [],
    };
    vi.mocked(generateAndStoreRecipes).mockResolvedValueOnce(mockResult);

    const request = new Request('http://localhost/api/recipes/generate', {
      method: 'POST',
      body: JSON.stringify({
        count: 3,
        meal_type: 'cena',
        overrides: {
          diet_tags: ['vegano'],
          appliances: ['friggitrice-ad-aria'],
        },
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(generateAndStoreRecipes).toHaveBeenCalledWith({
      count: 3,
      mealType: 'cena',
      overrides: {
        diet_tags: ['vegano'],
        appliances: ['friggitrice-ad-aria'],
      },
    });
  });

  it('maps LlmError code config to 500 llm_not_configured', async () => {
    const { generateAndStoreRecipes } = await import('@/lib/recipes');
    vi.mocked(generateAndStoreRecipes).mockRejectedValueOnce(
      new LlmError('config', 'API key missing')
    );

    const request = new Request('http://localhost/api/recipes/generate', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(500);

    const data = await response.json();
    expect(data).toEqual({
      error: {
        code: 'llm_not_configured',
        message: 'Generazione non disponibile: il modello non è configurato.',
      },
    });
  });

  it('maps LlmError code timeout to 504 llm_timeout', async () => {
    const { generateAndStoreRecipes } = await import('@/lib/recipes');
    vi.mocked(generateAndStoreRecipes).mockRejectedValueOnce(
      new LlmError('timeout', 'Model timed out')
    );

    const request = new Request('http://localhost/api/recipes/generate', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(504);

    const data = await response.json();
    expect(data).toEqual({
      error: {
        code: 'llm_timeout',
        message: 'La generazione non è andata a buon fine. Riprova.',
      },
    });
  });

  it('maps LlmError code provider to 502 llm_unavailable', async () => {
    const { generateAndStoreRecipes } = await import('@/lib/recipes');
    vi.mocked(generateAndStoreRecipes).mockRejectedValueOnce(
      new LlmError('provider', 'Provider 503 error')
    );

    const request = new Request('http://localhost/api/recipes/generate', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(502);

    const data = await response.json();
    expect(data).toEqual({
      error: {
        code: 'llm_unavailable',
        message: 'La generazione non è andata a buon fine. Riprova.',
      },
    });
  });

  it('maps LlmError code invalid_output to 502 llm_invalid_output', async () => {
    const { generateAndStoreRecipes } = await import('@/lib/recipes');
    vi.mocked(generateAndStoreRecipes).mockRejectedValueOnce(
      new LlmError('invalid_output', 'Could not parse JSON')
    );

    const request = new Request('http://localhost/api/recipes/generate', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(502);

    const data = await response.json();
    expect(data).toEqual({
      error: {
        code: 'llm_invalid_output',
        message: 'La generazione non è andata a buon fine. Riprova.',
      },
    });
  });

  it('maps generic errors to 500 internal_error and masks raw error message', async () => {
    const { generateAndStoreRecipes } = await import('@/lib/recipes');
    vi.mocked(generateAndStoreRecipes).mockRejectedValueOnce(
      new Error('secret database connection details boom')
    );

    const request = new Request('http://localhost/api/recipes/generate', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await POST(request);
    expect(response.status).toBe(500);

    const text = await response.text();
    expect(text).not.toContain('boom');
    expect(text).not.toContain('secret database connection');

    const data = JSON.parse(text);
    expect(data).toEqual({
      error: {
        code: 'internal_error',
        message: 'Qualcosa è andato storto. Riprova.',
      },
    });
  });
});
