// Solo lato server: importa il DB. I componenti client usano normalize.ts e client.ts.

import { loadHousehold, updateHousehold } from '@/lib/db/repositories/household-repo';
import {
  type SaveSettingsResult,
  type SettingsView,
  type UpdateSettingsRequest,
  UpdateSettingsRequestSchema,
} from '@/lib/domain/types';
import { householdToSettings, normalizeSettings, settingsEqual, toSettingsView } from './normalize';

/**
 * Legge le impostazioni correnti dell'household (default o `householdId`).
 */
export async function getSettings(householdId?: string): Promise<SettingsView> {
  const household = await loadHousehold(householdId);
  return toSettingsView(household);
}

/**
 * Valida e salva le nuove impostazioni. Non scrive se nulla cambia e
 * l'onboarding non va completato (`changed: false` senza scrittura).
 */
export async function saveSettings(
  input: UpdateSettingsRequest,
  householdId?: string
): Promise<SaveSettingsResult> {
  const parsed = UpdateSettingsRequestSchema.parse(input);
  const { complete_onboarding, ...fields } = parsed;
  const next = normalizeSettings(fields);

  const current = await loadHousehold(householdId);
  const changed = !settingsEqual(next, householdToSettings(current));
  const completing = complete_onboarding && current.onboarded_at === null;

  if (!changed && !completing) {
    return { settings: toSettingsView(current), changed: false };
  }

  const updated = await updateHousehold(
    { ...next, ...(completing ? { onboarded_at: new Date() } : {}) },
    current.id
  );

  return { settings: toSettingsView(updated), changed };
}
