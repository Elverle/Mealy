// Funzioni pure, importabili anche dal client: nessuna dipendenza dal DB.
// Solo `@/lib/domain/types` (regola vincolante §0.3.2 del piano di F3).

import {
  APPLIANCE_VALUES,
  DIET_FLAG_VALUES,
  MEAL_STYLE_TAG_VALUES,
  MEAL_TYPE_VALUES,
  type Household,
  type HouseholdSettings,
  type SettingsView,
} from '@/lib/domain/types';

/**
 * Riduce un array di valori all'ordine canonico dato da `order`, eliminando
 * duplicati e valori non presenti in `order`.
 */
function reduceToOrder<T extends string>(values: readonly T[], order: readonly T[]): T[] {
  const present = new Set(values);
  return order.filter((v) => present.has(v));
}

/**
 * Ritorna una nuova versione delle impostazioni con `persons` invariato e
 * ciascun array ridotto ai valori presenti, senza duplicati e nell'ordine
 * dell'enum corrispondente.
 */
export function normalizeSettings(settings: HouseholdSettings): HouseholdSettings {
  return {
    persons: settings.persons,
    meals: reduceToOrder(settings.meals, MEAL_TYPE_VALUES),
    meal_style_tags: reduceToOrder(settings.meal_style_tags, MEAL_STYLE_TAG_VALUES),
    diet_tags: reduceToOrder(settings.diet_tags, DIET_FLAG_VALUES),
    appliances: reduceToOrder(settings.appliances, APPLIANCE_VALUES),
  };
}

/**
 * Confronta due impostazioni dopo normalizzazione: `persons` uguale e i
 * quattro array con gli stessi elementi, nello stesso ordine.
 */
export function settingsEqual(a: HouseholdSettings, b: HouseholdSettings): boolean {
  const na = normalizeSettings(a);
  const nb = normalizeSettings(b);

  if (na.persons !== nb.persons) return false;

  const arrayKeys = ['meals', 'meal_style_tags', 'diet_tags', 'appliances'] as const;
  return arrayKeys.every((key) => {
    const va = na[key];
    const vb = nb[key];
    return va.length === vb.length && va.every((v, i) => v === vb[i]);
  });
}

/**
 * Estrae le impostazioni dai 5 campi corrispondenti dell'household e le
 * normalizza. Nessuna validazione: un household con `meals` vuoto restituisce
 * `meals: []`.
 */
export function householdToSettings(household: Household): HouseholdSettings {
  return normalizeSettings({
    persons: household.persons,
    meals: household.meals,
    meal_style_tags: household.meal_style_tags,
    diet_tags: household.diet_tags,
    appliances: household.appliances,
  });
}

/**
 * Vista pubblica delle impostazioni per `GET /api/settings`. `updated_at`
 * (ISO) è il riferimento per il contratto U1 di F4.
 */
export function toSettingsView(household: Household): SettingsView {
  return {
    ...householdToSettings(household),
    onboarded: household.onboarded_at !== null,
    updated_at: household.updated_at.toISOString(),
  };
}

/**
 * Attiva/disattiva `value` in `values` mantenendo l'ordine canonico `order`.
 * Usata dai controlli UI (WP2) per i quattro campi a scelta multipla.
 */
export function toggleInOrder<T extends string>(
  values: readonly T[],
  order: readonly T[],
  value: T
): T[] {
  const next = new Set(values);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return order.filter((v) => next.has(v));
}
