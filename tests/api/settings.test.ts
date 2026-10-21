// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PUT, runtime, dynamic } from '@/app/api/settings/route';
import type { SaveSettingsResult, SettingsView } from '@/lib/domain/types';

vi.mock('@/lib/settings/service', () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

describe('GET /api/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports correct route segment configurations', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
  });

  it('returns 200 with the value from the service', async () => {
    const { getSettings } = await import('@/lib/settings/service');
    const mockSettings: SettingsView = {
      persons: 2,
      meals: ['pranzo', 'cena'],
      meal_style_tags: ['veloce'],
      diet_tags: [],
      appliances: ['fornelli'],
      onboarded: false,
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    vi.mocked(getSettings).mockResolvedValueOnce(mockSettings);

    const response = await GET();
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toEqual(mockSettings);
  });

  it('maps a thrown error to 500 internal_error without leaking the original message', async () => {
    const { getSettings } = await import('@/lib/settings/service');
    vi.mocked(getSettings).mockRejectedValueOnce(new Error('secret database connection details boom'));

    const response = await GET();
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

describe('PUT /api/settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 invalid_request on malformed JSON body', async () => {
    const request = new Request('http://localhost/api/settings', {
      method: 'PUT',
      body: '{',
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data).toEqual({
      error: {
        code: 'invalid_request',
        message: 'Richiesta non valida.',
      },
    });
  });

  it('returns 400 with details containing path "persons" when persons: 0', async () => {
    const request = new Request('http://localhost/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        persons: 0,
        meals: ['pranzo'],
        meal_style_tags: [],
        diet_tags: [],
        appliances: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error.code).toBe('invalid_request');
    expect(data.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'persons' })])
    );
  });

  it('returns 400 when unknown keys are passed', async () => {
    const request = new Request('http://localhost/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ foo: 1 }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.error.code).toBe('invalid_request');
  });

  it('forwards a valid body without complete_onboarding as complete_onboarding: false', async () => {
    const { saveSettings } = await import('@/lib/settings/service');
    const mockResult: SaveSettingsResult = {
      settings: {
        persons: 2,
        meals: ['pranzo', 'cena'],
        meal_style_tags: ['veloce'],
        diet_tags: [],
        appliances: ['fornelli'],
        onboarded: false,
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      changed: true,
    };
    vi.mocked(saveSettings).mockResolvedValueOnce(mockResult);

    const request = new Request('http://localhost/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        persons: 2,
        meals: ['pranzo', 'cena'],
        meal_style_tags: ['veloce'],
        diet_tags: [],
        appliances: ['fornelli'],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PUT(request);
    expect(response.status).toBe(200);

    expect(saveSettings).toHaveBeenCalledWith({
      persons: 2,
      meals: ['pranzo', 'cena'],
      meal_style_tags: ['veloce'],
      diet_tags: [],
      appliances: ['fornelli'],
      complete_onboarding: false,
    });

    const data = await response.json();
    expect(data).toEqual(mockResult);
  });

  it('forwards a valid body with complete_onboarding: true', async () => {
    const { saveSettings } = await import('@/lib/settings/service');
    const mockResult: SaveSettingsResult = {
      settings: {
        persons: 2,
        meals: ['pranzo', 'cena'],
        meal_style_tags: ['veloce'],
        diet_tags: [],
        appliances: ['fornelli'],
        onboarded: true,
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      changed: false,
    };
    vi.mocked(saveSettings).mockResolvedValueOnce(mockResult);

    const request = new Request('http://localhost/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        persons: 2,
        meals: ['pranzo', 'cena'],
        meal_style_tags: ['veloce'],
        diet_tags: [],
        appliances: ['fornelli'],
        complete_onboarding: true,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PUT(request);
    expect(response.status).toBe(200);

    expect(saveSettings).toHaveBeenCalledWith({
      persons: 2,
      meals: ['pranzo', 'cena'],
      meal_style_tags: ['veloce'],
      diet_tags: [],
      appliances: ['fornelli'],
      complete_onboarding: true,
    });

    const data = await response.json();
    expect(data).toEqual(mockResult);
  });

  it('accepts the new style tags and forwards them to saveSettings', async () => {
    const { saveSettings } = await import('@/lib/settings/service');
    const mockResult: SaveSettingsResult = {
      settings: {
        persons: 2,
        meals: ['pranzo', 'cena'],
        meal_style_tags: ['tradizionale', 'piatto-freddo'],
        diet_tags: [],
        appliances: ['fornelli'],
        onboarded: false,
        updated_at: '2026-01-01T00:00:00.000Z',
      },
      changed: true,
    };
    vi.mocked(saveSettings).mockResolvedValueOnce(mockResult);

    const request = new Request('http://localhost/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        persons: 2,
        meals: ['pranzo', 'cena'],
        meal_style_tags: ['tradizionale', 'piatto-freddo'],
        diet_tags: [],
        appliances: ['fornelli'],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PUT(request);
    expect(response.status).toBe(200);
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ meal_style_tags: ['tradizionale', 'piatto-freddo'] })
    );
    expect(await response.json()).toEqual(mockResult);
  });

  it('returns 400 for a style tag outside the twelve and does not save', async () => {
    const { saveSettings } = await import('@/lib/settings/service');

    const request = new Request('http://localhost/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        persons: 2,
        meals: ['pranzo'],
        meal_style_tags: ['brunch'],
        diet_tags: [],
        appliances: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PUT(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.code).toBe('invalid_request');
    expect(data.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'meal_style_tags.0' })])
    );
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('maps a thrown error from saveSettings to 500 internal_error', async () => {
    const { saveSettings } = await import('@/lib/settings/service');
    vi.mocked(saveSettings).mockRejectedValueOnce(new Error('boom'));

    const request = new Request('http://localhost/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        persons: 2,
        meals: ['pranzo'],
        meal_style_tags: [],
        diet_tags: [],
        appliances: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await PUT(request);
    expect(response.status).toBe(500);

    const data = await response.json();
    expect(data).toEqual({
      error: {
        code: 'internal_error',
        message: 'Qualcosa è andato storto. Riprova.',
      },
    });
  });
});
