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
const TAG_MIGRATION_IDX = 6;
const TAG_MIGRATION_FILE = '0006_remove_piatto_unico_tag.sql';
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** Il file SQL della migrazione, un'istruzione per elemento. */
function readTagMigrationStatements(): string[] {
  const sqlText = fs.readFileSync(path.join(MIGRATIONS_FOLDER, TAG_MIGRATION_FILE), 'utf-8');
  return sqlText
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

describe.skipIf(!dbUp)('migration 0006_remove_piatto_unico_tag', () => {
  // Database usa-e-getta: quello di sviluppo, usato dagli altri file di test, non viene toccato.
  const databaseName = `mealy_tag_${process.pid}_${Date.now()}`;
  const url = new URL(
    process.env.DATABASE_URL || 'postgresql://mealy:mealy@localhost:5432/mealy_dev'
  );
  url.pathname = `/${databaseName}`;
  const connectionString = url.toString();

  let scratch: postgres.Sql | undefined;
  let previousReleaseFolder: string | undefined;
  let householdStyleTagsAfterMigration: string[] = [];
  let recipeTagsAfterMigration: Record<string, string[]> = {};

  beforeAll(async () => {
    await client.unsafe(`create database "${databaseName}"`);
    scratch = postgres(connectionString, { max: 1, onnotice: () => {} });

    // Le migrazioni com'erano prima di quella in prova: il journal filtrato a idx < 6, così il test
    // regge anche quando si aggiungono migrazioni successive.
    previousReleaseFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'mealy-tag-'));
    fs.cpSync(MIGRATIONS_FOLDER, previousReleaseFolder, { recursive: true });
    const journalPath = path.join(previousReleaseFolder, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as {
      entries: JournalEntry[];
    };
    journal.entries = journal.entries.filter((entry) => entry.idx < TAG_MIGRATION_IDX);
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    await migrate(drizzle(scratch), { migrationsFolder: previousReleaseFolder });

    const [household] = await scratch<{ id: string }[]>`
      insert into households (persons, meals, meal_style_tags)
      values (2, ${['pranzo', 'cena']}::text[], ${['veloce', 'piatto-unico']}::text[])
      returning id
    `;
    const recipes: Array<{ title: string; slug: string; tags: string[] }> = [
      { title: 'Ricetta piatto unico', slug: 'ricetta-piatto-unico', tags: ['piatto-unico', 'comfort-food'] },
      { title: 'Ricetta leggera', slug: 'ricetta-leggera', tags: ['leggero'] },
    ];
    for (const recipe of recipes) {
      await scratch`
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
      `;
    }

    await migrate(drizzle(scratch), { migrationsFolder: MIGRATIONS_FOLDER });

    const [householdAfter] = await scratch<{ meal_style_tags: string[] }[]>`
      select meal_style_tags from households
    `;
    householdStyleTagsAfterMigration = householdAfter.meal_style_tags;
    const rows = await scratch<{ title: string; tags: string[] }[]>`select title, tags from recipes`;
    recipeTagsAfterMigration = Object.fromEntries(rows.map((row) => [row.title, row.tags]));
  }, 60_000);

  afterAll(async () => {
    await scratch?.end({ timeout: 5 });
    await client.unsafe(`drop database if exists "${databaseName}" with (force)`);
    if (previousReleaseFolder) fs.rmSync(previousReleaseFolder, { recursive: true, force: true });
  }, 60_000);

  it('removes piatto-unico from the style tags of every household', () => {
    expect(householdStyleTagsAfterMigration).toEqual(['veloce']);
  });

  it('removes piatto-unico from the tags of every recipe and keeps the others', () => {
    expect(recipeTagsAfterMigration).toEqual({
      'Ricetta piatto unico': ['comfort-food'],
      'Ricetta leggera': ['leggero'],
    });
  });

  it('is idempotent: running its statements again changes nothing', async () => {
    const statements = readTagMigrationStatements();
    expect(statements).toHaveLength(2);

    for (const statement of statements) await scratch!.unsafe(statement);

    const [householdAgain] = await scratch!<{ meal_style_tags: string[] }[]>`
      select meal_style_tags from households
    `;
    expect(householdAgain.meal_style_tags).toEqual(householdStyleTagsAfterMigration);
    const rows = await scratch!<{ title: string; tags: string[] }[]>`select title, tags from recipes`;
    expect(Object.fromEntries(rows.map((row) => [row.title, row.tags]))).toEqual(recipeTagsAfterMigration);
  });
});
