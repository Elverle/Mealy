import { eq } from 'drizzle-orm';
import { db } from '../index';
import { households } from '../schema';
import {
  DEFAULT_HOUSEHOLD,
  DEFAULT_HOUSEHOLD_ID,
  Household,
  HouseholdSchema,
} from '@/lib/domain/types';

/**
 * Get household by ID. Returns null if not found.
 */
export async function getHouseholdById(id: string): Promise<Household | null> {
  const result = await db.query.households.findFirst({
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
 * Update household fields for a given ID (defaults to DEFAULT_HOUSEHOLD_ID).
 */
export async function updateHousehold(
  data: Partial<Omit<Household, 'id' | 'created_at' | 'updated_at'>>,
  id: string = DEFAULT_HOUSEHOLD_ID
): Promise<Household> {
  // Ensure the household exists first
  await ensureDefaultHousehold();

  const updateValues: Partial<typeof households.$inferInsert> = {
    updated_at: new Date(),
  };

  if (data.persons !== undefined) updateValues.persons = data.persons;
  if (data.meals !== undefined) updateValues.meals = [...data.meals];
  if (data.diet_tags !== undefined) updateValues.diet_tags = [...data.diet_tags];
  if (data.meal_style_tags !== undefined) updateValues.meal_style_tags = [...data.meal_style_tags];
  if (data.appliances !== undefined) updateValues.appliances = [...data.appliances];

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
