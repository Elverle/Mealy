import { client, db, households } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { DEFAULT_HOUSEHOLD, Household } from '@/lib/domain/types';

/**
 * Checks if the PostgreSQL database is reachable within 1000ms.
 * Never throws, returns false on connection failure or timeout.
 */
export async function isDbAvailable(): Promise<boolean> {
  try {
    await Promise.race([
      client`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Asserts that the database has been migrated and required extensions exist.
 * Throws an explicit error if the schema or pg_trgm extension is missing.
 */
export async function assertDbMigrated(): Promise<void> {
  const result = await client<[{ t: string | null; trgm: boolean }]>`
    select to_regclass('public.recipes') as t, exists(select 1 from pg_extension where extname = 'pg_trgm') as trgm
  `;
  const row = result[0];
  if (!row || row.t === null || row.trgm === false) {
    throw new Error('Schema DB assente o incompleto: esegui `pnpm db:migrate` prima dei test.');
  }
}

/**
 * Inserts a dedicated test household to isolate test data from the singleton household.
 * Returns the generated household UUID.
 */
export async function createTestHousehold(
  overrides?: Partial<Pick<Household, 'persons' | 'meals' | 'diet_tags' | 'meal_style_tags' | 'appliances'>>
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(households).values({
    id,
    persons: overrides?.persons ?? DEFAULT_HOUSEHOLD.persons,
    meals: [...(overrides?.meals ?? DEFAULT_HOUSEHOLD.meals)],
    diet_tags: [...(overrides?.diet_tags ?? DEFAULT_HOUSEHOLD.diet_tags)],
    meal_style_tags: [...(overrides?.meal_style_tags ?? DEFAULT_HOUSEHOLD.meal_style_tags)],
    appliances: [...(overrides?.appliances ?? DEFAULT_HOUSEHOLD.appliances)],
    created_at: new Date(),
    updated_at: new Date(),
  });
  return id;
}

/**
 * Deletes a test household by ID. Cascades to related recipes, ingredients, etc.
 */
export async function deleteTestHousehold(id: string): Promise<void> {
  await db.delete(households).where(eq(households.id, id));
}
