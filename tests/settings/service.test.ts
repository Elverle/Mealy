// @vitest-environment node

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { db, households } from '@/lib/db';
import { getHouseholdById, loadHousehold } from '@/lib/db/repositories/household-repo';
import { buildConstraints } from '@/lib/recipes/constraints';
import { DEFAULT_HOUSEHOLD, type HouseholdSettings } from '@/lib/domain/types';
import { getSettings, saveSettings } from '@/lib/settings/service';
import { isDbAvailable, assertDbMigrated, createTestHousehold, deleteTestHousehold } from '@/tests/helpers/db';

const dbUp = await isDbAvailable();

const DEFAULT_SETTINGS: HouseholdSettings = {
  persons: DEFAULT_HOUSEHOLD.persons,
  meals: [...DEFAULT_HOUSEHOLD.meals],
  meal_style_tags: [...DEFAULT_HOUSEHOLD.meal_style_tags],
  diet_tags: [...DEFAULT_HOUSEHOLD.diet_tags],
  appliances: [...DEFAULT_HOUSEHOLD.appliances],
};

describe.skipIf(!dbUp)('lib/settings/service', () => {
  let createdHouseholdIds: string[] = [];

  beforeAll(async () => {
    await assertDbMigrated();
  });

  afterEach(async () => {
    for (const id of createdHouseholdIds) {
      await deleteTestHousehold(id);
    }
    createdHouseholdIds = [];
  });

  async function createHousehold(): Promise<string> {
    const id = await createTestHousehold();
    createdHouseholdIds.push(id);
    return id;
  }

  it('getSettings returns onboarded: false and the household defaults', async () => {
    const id = await createHousehold();

    const settings = await getSettings(id);

    expect(settings.onboarded).toBe(false);
    expect(settings.persons).toBe(DEFAULT_SETTINGS.persons);
    expect(settings.meals).toEqual(DEFAULT_SETTINGS.meals);
    expect(settings.meal_style_tags).toEqual(DEFAULT_SETTINGS.meal_style_tags);
    expect(settings.diet_tags).toEqual(DEFAULT_SETTINGS.diet_tags);
    expect(settings.appliances).toEqual(DEFAULT_SETTINGS.appliances);
  });

  it('saveSettings with identical values does not change updated_at', async () => {
    const id = await createHousehold();
    const before = await getSettings(id);

    const result = await saveSettings({ ...DEFAULT_SETTINGS }, id);

    expect(result.changed).toBe(false);
    expect(result.settings.updated_at).toBe(before.updated_at);
  });

  it('saveSettings with new values persists them, normalized, and bumps updated_at', async () => {
    const id = await createHousehold();
    // `updated_at` iniziale e finale sono entrambi scritti da `now()` del DB;
    // `Date` JS tronca ai millisecondi, quindi senza questo scarto un insert
    // e il successivo update nello stesso ms farebbero fallire il confronto
    // `toBeGreaterThan` qui sotto in modo intermittente.
    await db
      .update(households)
      .set({ updated_at: sql`now() - interval '1 second'` })
      .where(eq(households.id, id));
    const before = await getSettings(id);

    const result = await saveSettings(
      {
        persons: 4,
        meals: ['cena'],
        meal_style_tags: ['proteico', 'veloce'],
        diet_tags: ['vegano'],
        appliances: ['friggitrice-ad-aria'],
      },
      id
    );

    expect(result.changed).toBe(true);
    expect(result.settings.meal_style_tags).toEqual(['veloce', 'proteico']);
    expect(Date.parse(result.settings.updated_at)).toBeGreaterThan(Date.parse(before.updated_at));

    const reread = await getSettings(id);
    expect(reread).toEqual(result.settings);

    // Vincoli verso planner e LLM: i vincoli costruiti dall'household salvato
    // riflettono le nuove impostazioni normalizzate.
    const household = await getHouseholdById(id);
    const constraints = buildConstraints(household!, null);
    expect(constraints.persons).toBe(4);
    expect(constraints.diet_tags).toEqual(['vegano']);
    expect(constraints.appliances).toEqual(['friggitrice-ad-aria']);
    expect(constraints.meal_style_tags).toEqual(['veloce', 'proteico']);
  });

  it('saveSettings with complete_onboarding: true completes onboarding without a spurious update on repeat', async () => {
    const id = await createHousehold();

    const result = await saveSettings({ ...DEFAULT_SETTINGS, complete_onboarding: true }, id);

    expect(result.changed).toBe(false);
    expect(result.settings.onboarded).toBe(true);

    const afterFirst = await getHouseholdById(id);
    expect(afterFirst?.onboarded_at).not.toBeNull();

    await saveSettings({ ...DEFAULT_SETTINGS, complete_onboarding: true }, id);

    const afterSecond = await getHouseholdById(id);
    expect(afterSecond?.onboarded_at?.getTime()).toBe(afterFirst?.onboarded_at?.getTime());
  });

  it('saveSettings rejects an empty meals array with a ZodError and writes nothing', async () => {
    const id = await createHousehold();
    const before = await getHouseholdById(id);

    await expect(saveSettings({ ...DEFAULT_SETTINGS, meals: [] }, id)).rejects.toBeInstanceOf(z.ZodError);

    const after = await getHouseholdById(id);
    expect(after).toEqual(before);
  });

  it('saveSettings rejects an unknown household id with a "non trovato" message', async () => {
    await expect(saveSettings({ ...DEFAULT_SETTINGS }, crypto.randomUUID())).rejects.toThrow(/non trovato/);
  });

  it('loadHousehold throws a "non trovato" error for an unknown id', async () => {
    await expect(loadHousehold(crypto.randomUUID())).rejects.toThrow(/non trovato/);
  });
});

describe('migration 0002 file content', () => {
  it('exists and adds the onboarded_at column', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../lib/db/migrations/0002_add_household_onboarded_at.sql'
    );
    expect(fs.existsSync(migrationPath)).toBe(true);

    const content = fs.readFileSync(migrationPath, 'utf-8');
    expect(content).toContain('ADD COLUMN "onboarded_at"');
  });
});
