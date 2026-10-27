// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HOUSEHOLD,
  DEFAULT_MEAL_COMPOSITIONS,
  MEAL_TYPE_VALUES,
  HouseholdSchema,
  UpdateSettingsRequestSchema,
  type Household,
  type HouseholdSettings,
} from '@/lib/domain/types';
import {
  householdToSettings,
  normalizeSettings,
  settingsEqual,
  toggleInOrder,
  toSettingsView,
} from '@/lib/settings/normalize';

describe('normalizeSettings', () => {
  it('reduces each array to enum order, removing duplicates', () => {
    const settings: HouseholdSettings = {
      persons: 2,
      meals: ['cena', 'pranzo', 'cena'],
      meal_compositions: DEFAULT_MEAL_COMPOSITIONS,
      meal_style_tags: ['economico', 'veloce', 'economico'],
      diet_tags: [],
      appliances: [],
    };

    const normalized = normalizeSettings(settings);

    expect(normalized.meals).toEqual(['pranzo', 'cena']);
    expect(normalized.meal_style_tags).toEqual(['veloce', 'economico']);
    expect(normalized.persons).toBe(2);
  });

  it('orders each meal composition list by enum order, removing duplicates', () => {
    const settings: HouseholdSettings = {
      persons: 2,
      meals: ['pranzo', 'cena'],
      meal_compositions: {
        pranzo: ['secondo-contorno', 'primo', 'secondo-contorno'],
        cena: ['piatto-unico', 'primo-contorno', 'piatto-unico'],
      },
      meal_style_tags: [],
      diet_tags: [],
      appliances: [],
    };

    const normalized = normalizeSettings(settings);

    expect(normalized.meal_compositions).toEqual({
      pranzo: ['primo', 'secondo-contorno'],
      cena: ['piatto-unico', 'primo-contorno'],
    });
  });
});

describe('settingsEqual', () => {
  const base: HouseholdSettings = {
    persons: 2,
    meals: ['pranzo', 'cena'],
    meal_compositions: DEFAULT_MEAL_COMPOSITIONS,
    meal_style_tags: ['veloce', 'salutare'],
    diet_tags: ['vegetariano'],
    appliances: ['fornelli'],
  };

  it('returns true when arrays are given in a different order', () => {
    const other: HouseholdSettings = {
      ...base,
      meals: ['cena', 'pranzo'],
      meal_compositions: DEFAULT_MEAL_COMPOSITIONS,
      meal_style_tags: ['salutare', 'veloce'],
    };

    expect(settingsEqual(base, other)).toBe(true);
  });

  it('returns false when persons differs', () => {
    const other: HouseholdSettings = { ...base, persons: 4 };

    expect(settingsEqual(base, other)).toBe(false);
  });

  it('returns false when only one lunch composition changes', () => {
    const other: HouseholdSettings = {
      ...base,
      meal_compositions: { ...base.meal_compositions, pranzo: ['piatto-unico'] },
    };

    expect(settingsEqual(base, other)).toBe(false);
  });

  it('returns false when only one dinner composition changes', () => {
    const other: HouseholdSettings = {
      ...base,
      meal_compositions: { ...base.meal_compositions, cena: ['primo', 'secondo'] },
    };

    expect(settingsEqual(base, other)).toBe(false);
  });

  it('returns true when the composition lists are given in a different order', () => {
    const other: HouseholdSettings = {
      ...base,
      meal_compositions: {
        pranzo: [...DEFAULT_MEAL_COMPOSITIONS.pranzo].reverse(),
        cena: [...DEFAULT_MEAL_COMPOSITIONS.cena].reverse(),
      },
    };

    expect(settingsEqual(base, other)).toBe(true);
  });
});

describe('toSettingsView', () => {
  const household: Household = {
    ...DEFAULT_HOUSEHOLD,
    onboarded_at: null,
    updated_at: new Date('2026-02-01T10:00:00Z'),
  };

  it('maps onboarded_at: null to onboarded: false', () => {
    const view = toSettingsView(household);
    expect(view.onboarded).toBe(false);
  });

  it('maps a date to onboarded: true and updated_at as ISO string', () => {
    const view = toSettingsView({ ...household, onboarded_at: new Date('2026-02-01T09:00:00Z') });
    expect(view.onboarded).toBe(true);
    expect(view.updated_at).toBe('2026-02-01T10:00:00.000Z');
  });
});

describe('householdToSettings', () => {
  it('does not validate: an household with empty meals returns meals: []', () => {
    const household: Household = { ...DEFAULT_HOUSEHOLD, meals: [] };
    const settings = householdToSettings(household);
    expect(settings.meals).toEqual([]);
  });
});

describe('toggleInOrder', () => {
  it('adds a value not present, respecting the canonical order', () => {
    expect(toggleInOrder(['cena'], MEAL_TYPE_VALUES, 'pranzo')).toEqual(['pranzo', 'cena']);
  });

  it('removes a value already present', () => {
    expect(toggleInOrder(['pranzo', 'cena'], MEAL_TYPE_VALUES, 'pranzo')).toEqual(['cena']);
  });
});

describe('HouseholdSchema onboarded_at', () => {
  it('parses DEFAULT_HOUSEHOLD with onboarded_at === null', () => {
    const parsed = HouseholdSchema.parse({ ...DEFAULT_HOUSEHOLD });
    expect(parsed.onboarded_at).toBeNull();
  });

  it('defaults onboarded_at to null when absent from the input object', () => {
    const { onboarded_at, ...rest } = DEFAULT_HOUSEHOLD;
    void onboarded_at;
    const parsed = HouseholdSchema.parse(rest);
    expect(parsed.onboarded_at).toBeNull();
  });
});

describe('UpdateSettingsRequestSchema', () => {
  const validBody = {
    persons: 2,
    meals: ['pranzo', 'cena'],
    meal_compositions: DEFAULT_MEAL_COMPOSITIONS,
    meal_style_tags: ['veloce'],
    diet_tags: [],
    appliances: ['fornelli'],
  };

  it('rejects persons: 0', () => {
    const result = UpdateSettingsRequestSchema.safeParse({ ...validBody, persons: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects persons: 13', () => {
    const result = UpdateSettingsRequestSchema.safeParse({ ...validBody, persons: 13 });
    expect(result.success).toBe(false);
  });

  it('rejects an empty meals array', () => {
    const result = UpdateSettingsRequestSchema.safeParse({ ...validBody, meals: [] });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown diet tag', () => {
    const result = UpdateSettingsRequestSchema.safeParse({ ...validBody, diet_tags: ['keto'] });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys', () => {
    const result = UpdateSettingsRequestSchema.safeParse({ ...validBody, foo: 1 });
    expect(result.success).toBe(false);
  });

  it('defaults complete_onboarding to false', () => {
    const result = UpdateSettingsRequestSchema.parse(validBody);
    expect(result.complete_onboarding).toBe(false);
  });
});
