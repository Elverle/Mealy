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

const dbUp = await isDbAvailable();

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'lib', 'db', 'migrations');
const COURSES_MIGRATION_IDX = 5;
const COURSES_MIGRATION_FILE = '0005_add_recipe_courses.sql';
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';
const MEASURED_UNIT = 'g';
const WITHOUT_QUANTITY_UNIT = 'qb';
const SEED_CATEGORY = 'dispensa';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** Ricetta pre-migrazione: i tag di partenza e le unità degli ingredienti (una riga ciascuno). */
interface RawRecipe {
  title: string;
  slug: string;
  tags: string[];
  units: string[];
}

/** L'ultima istruzione del file SQL della migrazione: l'UPDATE di FR-2.3. */
function readCoursesMigrationUpdate(): string {
  const sqlText = fs.readFileSync(path.join(MIGRATIONS_FOLDER, COURSES_MIGRATION_FILE), 'utf-8');
  const statements = sqlText
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  return statements[statements.length - 1];
}

const RECIPES_BEFORE_MIGRATION: RawRecipe[] = [
  {
    title: 'Ricetta sei misurati',
    slug: 'ricetta-sei-misurati',
    tags: ['veloce'],
    units: [...Array(6).fill(MEASURED_UNIT), WITHOUT_QUANTITY_UNIT, WITHOUT_QUANTITY_UNIT],
  },
  {
    title: 'Ricetta sette misurati',
    slug: 'ricetta-sette-misurati',
    tags: ['pochi-ingredienti', 'comfort-food'],
    units: Array(7).fill(MEASURED_UNIT),
  },
  {
    title: 'Ricetta tre ingredienti',
    slug: 'ricetta-tre-ingredienti',
    tags: ['pochi-ingredienti', 'leggero'],
    units: Array(3).fill(MEASURED_UNIT),
  },
  {
    title: 'Ricetta sette con due qb',
    slug: 'ricetta-sette-con-due-qb',
    tags: ['comfort-food'],
    units: [...Array(5).fill(MEASURED_UNIT), WITHOUT_QUANTITY_UNIT, WITHOUT_QUANTITY_UNIT],
  },
];

describe.skipIf(!dbUp)('migration 0005_add_recipe_courses', () => {
  // Database usa-e-getta: quello di sviluppo, usato dagli altri file di test, non viene toccato.
  const databaseName = `mealy_courses_${process.pid}_${Date.now()}`;
  const url = new URL(
    process.env.DATABASE_URL || 'postgresql://mealy:mealy@localhost:5432/mealy_dev'
  );
  url.pathname = `/${databaseName}`;
  const connectionString = url.toString();

  let scratch: postgres.Sql | undefined;
  let previousReleaseFolder: string | undefined;

  // Stato dei tag prima e dopo la migrazione, per titolo.
  let tagsAfterMigration: Record<string, string[]> = {};

  async function readTagsByTitle(): Promise<Record<string, string[]>> {
    const rows = await scratch!<{ title: string; tags: string[] }[]>`
      select title, tags from recipes
    `;
    return Object.fromEntries(rows.map((row) => [row.title, row.tags]));
  }

  beforeAll(async () => {
    await client.unsafe(`create database "${databaseName}"`);
    scratch = postgres(connectionString, { max: 1, onnotice: () => {} });

    // Le migrazioni com'erano prima di quella in prova: il journal filtrato a idx < 5, così il test
    // regge anche quando si aggiungono migrazioni successive.
    previousReleaseFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'mealy-courses-'));
    fs.cpSync(MIGRATIONS_FOLDER, previousReleaseFolder, { recursive: true });
    const journalPath = path.join(previousReleaseFolder, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as {
      entries: JournalEntry[];
    };
    journal.entries = journal.entries.filter((entry) => entry.idx < COURSES_MIGRATION_IDX);
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    await migrate(drizzle(scratch), { migrationsFolder: previousReleaseFolder });

    const [household] = await scratch<{ id: string }[]>`
      insert into households (persons, meals) values (2, ${['pranzo', 'cena']}::text[])
      returning id
    `;
    for (const recipe of RECIPES_BEFORE_MIGRATION) {
      const [row] = await scratch<{ id: string }[]>`
        insert into recipes (household_id, title, slug, steps, meal_types, tags, servings_base, prep_minutes)
        values (
          ${household.id},
          ${recipe.title},
          ${recipe.slug},
          ${JSON.stringify(['Cuoci.'])}::jsonb,
          ${['pranzo', 'cena']}::text[],
          ${recipe.tags}::text[],
          2,
          20
        )
        returning id
      `;
      for (const [index, unit] of recipe.units.entries()) {
        await scratch`
          insert into recipe_ingredients (recipe_id, canonical_name, display_name, unit, category)
          values (${row.id}, ${`ingrediente-${index}`}, ${`Ingrediente ${index}`}, ${unit}, ${SEED_CATEGORY})
        `;
      }
    }

    await migrate(drizzle(scratch), { migrationsFolder: MIGRATIONS_FOLDER });
    tagsAfterMigration = await readTagsByTitle();
  }, 60_000);

  afterAll(async () => {
    await scratch?.end({ timeout: 5 });
    await client.unsafe(`drop database if exists "${databaseName}" with (force)`);
    if (previousReleaseFolder) fs.rmSync(previousReleaseFolder, { recursive: true, force: true });
  }, 60_000);

  it('adds a non-nullable courses column, empty for every existing recipe', async () => {
    const [column] = await scratch!<{ udt_name: string; is_nullable: string }[]>`
      select udt_name, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'recipes' and column_name = 'courses'
    `;
    expect(column).toEqual({ udt_name: '_text', is_nullable: 'NO' });

    const rows = await scratch!<{ courses: string[] }[]>`select courses from recipes`;
    expect(rows).toHaveLength(RECIPES_BEFORE_MIGRATION.length);
    for (const row of rows) expect(row.courses).toEqual([]);
  });

  it('adds pochi-ingredienti to recipes with at most 6 measured ingredients and removes it from the others', () => {
    expect(tagsAfterMigration).toEqual({
      'Ricetta sei misurati': ['veloce', 'pochi-ingredienti'],
      'Ricetta sette misurati': ['comfort-food'],
      'Ricetta tre ingredienti': ['pochi-ingredienti', 'leggero'],
      'Ricetta sette con due qb': ['comfort-food', 'pochi-ingredienti'],
    });
  });

  it('is idempotent: running its UPDATE again changes no tag', async () => {
    const update = readCoursesMigrationUpdate();
    expect(update).toMatch(/^UPDATE "recipes"/);

    await scratch!.unsafe(update);

    expect(await readTagsByTitle()).toEqual(tagsAfterMigration);
  });
});
