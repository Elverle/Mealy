import { eq, sql, type SQL } from 'drizzle-orm';
import { db, type DbExecutor } from '../index';
import { households } from '../schema';
import {
  DEFAULT_HOUSEHOLD,
  DEFAULT_HOUSEHOLD_ID,
  Household,
  HouseholdSchema,
} from '@/lib/domain/types';

/**
 * Get household by ID. Returns null if not found.
 * `executor`: una transazione, per rileggere le impostazioni sotto un lock.
 */
export async function getHouseholdById(
  id: string,
  executor: DbExecutor = db
): Promise<Household | null> {
  const result = await executor.query.households.findFirst({
    where: eq(households.id, id),
  });

  if (!result) return null;
  return HouseholdSchema.parse(result);
}

/**
 * Ensures that the default singleton household exists in the database.
 * If absent, inserts DEFAULT_HOUSEHOLD. Idempotent.
 */
export async function ensureDefaultHousehold(): Promise<Household> {
  const existing = await getHouseholdById(DEFAULT_HOUSEHOLD_ID);
  if (existing) {
    return existing;
  }

  const [inserted] = await db
    .insert(households)
    .values({
      id: DEFAULT_HOUSEHOLD.id,
      persons: DEFAULT_HOUSEHOLD.persons,
      meals: [...DEFAULT_HOUSEHOLD.meals],
      diet_tags: [...DEFAULT_HOUSEHOLD.diet_tags],
      meal_style_tags: [...DEFAULT_HOUSEHOLD.meal_style_tags],
      appliances: [...DEFAULT_HOUSEHOLD.appliances],
      onboarded_at: null,
      created_at: DEFAULT_HOUSEHOLD.created_at,
      updated_at: DEFAULT_HOUSEHOLD.updated_at,
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    const fetched = await getHouseholdById(DEFAULT_HOUSEHOLD_ID);
    if (!fetched) {
      throw new Error('Failed to retrieve or create default household');
    }
    return fetched;
  }

  return HouseholdSchema.parse(inserted);
}

/**
 * Get the default singleton household. Creates it if it does not yet exist.
 */
export async function getDefaultHousehold(): Promise<Household> {
  const household = await getHouseholdById(DEFAULT_HOUSEHOLD_ID);
  if (household) {
    return household;
  }
  return ensureDefaultHousehold();
}

/**
 * Values accepted by `.set()` on the `households` table, con `updated_at`
 * forzato a un'espressione SQL (l'orologio del DB, non quello di Node).
 */
type HouseholdUpdateValues = Partial<Omit<typeof households.$inferInsert, 'updated_at'>> & {
  updated_at: SQL;
};

/**
 * Update household fields for a given ID (defaults to DEFAULT_HOUSEHOLD_ID).
 *
 * Invariante: `updated_at` rappresenta l'ultimo cambio dei vincoli o
 * dell'onboarding ed è il riferimento del contratto U1 (un piano è superato
 * se `updated_at > meal_plans.generated_at`, entrambi scritti dall'orologio
 * del DB con `now()`). Non chiamare questa funzione per scritture che non
 * cambiano i vincoli: chi la chiama deve verificare a monte che ci sia
 * davvero un cambiamento (v. `lib/settings/service.ts`).
 */
export async function updateHousehold(
  data: Partial<Omit<Household, 'id' | 'created_at' | 'updated_at'>>,
  id: string = DEFAULT_HOUSEHOLD_ID
): Promise<Household> {
  // Garantisce l'esistenza del singleton solo quando è quello l'id richiesto.
  if (id === DEFAULT_HOUSEHOLD_ID) {
    await ensureDefaultHousehold();
  }

  const updateValues: HouseholdUpdateValues = {
    updated_at: sql`now()`,
  };

  if (data.persons !== undefined) updateValues.persons = data.persons;
  if (data.meals !== undefined) updateValues.meals = [...data.meals];
  if (data.diet_tags !== undefined) updateValues.diet_tags = [...data.diet_tags];
  if (data.meal_style_tags !== undefined) updateValues.meal_style_tags = [...data.meal_style_tags];
  if (data.appliances !== undefined) updateValues.appliances = [...data.appliances];
  if (data.onboarded_at !== undefined) updateValues.onboarded_at = data.onboarded_at;

  const [updated] = await db
    .update(households)
    .set(updateValues)
    .where(eq(households.id, id))
    .returning();

  if (!updated) {
    throw new Error(`Household with id ${id} not found for update`);
  }

  return HouseholdSchema.parse(updated);
}

/**
 * Carica un household per l'uso da parte dei moduli applicativi (settings,
 * generazione ricette, ...): centralizza la regola "id assente o uguale al
 * singleton di default → crealo/leggilo; altrimenti cercalo per id o
 * segnala l'assenza" così che il messaggio d'errore resti uno solo.
 */
export async function loadHousehold(id?: string): Promise<Household> {
  if (id === undefined || id === DEFAULT_HOUSEHOLD_ID) {
    return getDefaultHousehold();
  }

  const household = await getHouseholdById(id);
  if (!household) {
    throw new Error(`Household ${id} non trovato`);
  }
  return household;
}
