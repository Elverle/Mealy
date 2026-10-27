// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isDbAvailable } from '@/tests/helpers/db';
import { client } from '@/lib/db';
import { DEFAULT_MEAL_COMPOSITIONS } from '@/lib/domain/types';

const dbUp = await isDbAvailable();

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'lib', 'db', 'migrations');
const COMPOSITIONS_MIGRATION_IDX = 7;

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** Ricetta pre-migrazione: le portate di partenza (ARRAY vuoto = non classificata). */
interface RawRecipe {
  title: string;
  slug: string;
  courses: string[];
}

/** Slot pre-migrazione: un giorno diverso per ogni ricetta, sempre a pranzo. */
interface RawSlot {
  day: string;
  recipeSlug: string | null;
}

const RECIPES_BEFORE_MIGRATION: RawRecipe[] = [
  { title: 'Secondo e piatto unico', slug: 'secondo-e-piatto-unico', courses: ['secondo', 'piatto-unico'] },
  { title: 'Solo primo', slug: 'solo-primo', courses: ['primo'] },
  { title: 'Solo secondo', slug: 'solo-secondo', courses: ['secondo'] },
  { title: 'Non classificata', slug: 'non-classificata', courses: [] },
];

const SLOTS_BEFORE_MIGRATION: RawSlot[] = [
  { day: '2026-10-05', recipeSlug: 'secondo-e-piatto-unico' },
  { day: '2026-10-06', recipeSlug: 'solo-primo' },
  { day: '2026-10-07', recipeSlug: 'solo-secondo' },
  { day: '2026-10-08', recipeSlug: 'non-classificata' },
  { day: '2026-10-09', recipeSlug: null },
];

const UNIQUE_VIOLATION = '23505';
const SIDE_COURSE = 'contorno';
const PLAN_WEEK_START = '2026-10-05';

describe.skipIf(!dbUp)('migration 0007_add_meal_compositions', () => {
  // Database usa-e-getta: quello di sviluppo, usato dagli altri file di test, non viene toccato.
  const databaseName = `mealy_compositions_${process.pid}_${Date.now()}`;
  const url = new URL(
    process.env.DATABASE_URL || 'postgresql://mealy:mealy@localhost:5432/mealy_dev'
  );
  url.pathname = `/${databaseName}`;
  const connectionString = url.toString();

  let scratch: postgres.Sql | undefined;
  let previousReleaseFolder: string | undefined;
  let planId: string;
  let householdId: string;
  let slotCourses: Record<string, string> = {};

  async function readSlotCourses(): Promise<Record<string, string>> {
    const rows = await scratch!<{ day: string; course: string }[]>`
      select to_char(day, 'YYYY-MM-DD') as day, course from plan_slots where plan_id = ${planId}
    `;
    return Object.fromEntries(rows.map((row) => [row.day, row.course]));
  }

  beforeAll(async () => {
    await client.unsafe(`create database "${databaseName}"`);
    scratch = postgres(connectionString, { max: 1, onnotice: () => {} });

    // Le migrazioni com'erano prima di quella in prova: il journal filtrato a idx < 7, così il test
    // regge anche quando si aggiungono migrazioni successive.
    previousReleaseFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'mealy-compositions-'));
    fs.cpSync(MIGRATIONS_FOLDER, previousReleaseFolder, { recursive: true });
    const journalPath = path.join(previousReleaseFolder, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as {
      entries: JournalEntry[];
    };
    journal.entries = journal.entries.filter((entry) => entry.idx < COMPOSITIONS_MIGRATION_IDX);
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    await migrate(drizzle(scratch), { migrationsFolder: previousReleaseFolder });

    const [household] = await scratch<{ id: string }[]>`
      insert into households (persons, meals) values (2, ${['pranzo', 'cena']}::text[])
      returning id
    `;
    householdId = household.id;

    const recipeIds: Record<string, string> = {};
    for (const recipe of RECIPES_BEFORE_MIGRATION) {
      const [row] = await scratch<{ id: string }[]>`
        insert into recipes (household_id, title, slug, steps, meal_types, courses, servings_base, prep_minutes)
        values (
          ${householdId},
          ${recipe.title},
          ${recipe.slug},
          ${JSON.stringify(['Cuoci.'])}::jsonb,
          ${['pranzo', 'cena']}::text[],
          ${recipe.courses}::text[],
          2,
          20
        )
        returning id
      `;
      recipeIds[recipe.slug] = row.id;
    }

    const [plan] = await scratch<{ id: string }[]>`
      insert into meal_plans (household_id, week_start) values (${householdId}, ${PLAN_WEEK_START})
      returning id
    `;
    planId = plan.id;

    for (const slot of SLOTS_BEFORE_MIGRATION) {
      const recipeId = slot.recipeSlug === null ? null : recipeIds[slot.recipeSlug];
      await scratch`
        insert into plan_slots (plan_id, day, meal, recipe_id, servings)
        values (${planId}, ${slot.day}, 'pranzo', ${recipeId}, 2)
      `;
    }

    await migrate(drizzle(scratch), { migrationsFolder: MIGRATIONS_FOLDER });
    slotCourses = await readSlotCourses();
  }, 60_000);

  afterAll(async () => {
    await scratch?.end({ timeout: 5 });
    await client.unsafe(`drop database if exists "${databaseName}" with (force)`);
    if (previousReleaseFolder) fs.rmSync(previousReleaseFolder, { recursive: true, force: true });
  }, 60_000);

  it('gives every existing slot the course of its recipe: principal course first, piatto-unico when unclassified or missing', () => {
    expect(slotCourses).toEqual({
      '2026-10-05': 'piatto-unico',
      '2026-10-06': 'primo',
      '2026-10-07': 'secondo',
      '2026-10-08': 'piatto-unico',
      '2026-10-09': 'piatto-unico',
    });
  });

  it('sets the default meal compositions on every existing household', async () => {
    const [row] = await scratch!<{ meal_compositions: unknown }[]>`
      select meal_compositions from households where id = ${householdId}
    `;
    expect(row.meal_compositions).toEqual(DEFAULT_MEAL_COMPOSITIONS);
  });

  it('rejects a second main course in the same meal of the same plan', async () => {
    await expect(
      scratch!`
        insert into plan_slots (plan_id, day, meal, course, servings)
        values (${planId}, '2026-10-05', 'pranzo', 'primo', 2)
      `
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });

  it('accepts one side dish in a meal that already has a main course', async () => {
    await scratch!`
      insert into plan_slots (plan_id, day, meal, course, servings)
      values (${planId}, '2026-10-05', 'pranzo', ${SIDE_COURSE}, 2)
    `;

    const rows = await scratch!<{ course: string }[]>`
      select course from plan_slots
      where plan_id = ${planId} and day = '2026-10-05' and meal = 'pranzo' and course = ${SIDE_COURSE}
    `;
    expect(rows).toHaveLength(1);
  });

  it('rejects a second side dish in the same meal', async () => {
    await expect(
      scratch!`
        insert into plan_slots (plan_id, day, meal, course, servings)
        values (${planId}, '2026-10-05', 'pranzo', ${SIDE_COURSE}, 2)
      `
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });
});
