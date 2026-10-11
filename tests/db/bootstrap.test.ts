// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { isDbAvailable, assertDbMigrated } from '@/tests/helpers/db';
import { runDbBootstrap } from '@/lib/db/bootstrap';
import { client } from '@/lib/db';
import { FIXTURE_INGREDIENT_ALIASES } from '@/fixtures';

const dbUp = await isDbAvailable();

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'lib', 'db', 'migrations');
// Porta 1: nessun Postgres in ascolto, la connessione viene rifiutata.
const UNREACHABLE_DATABASE = 'postgresql://mealy:mealy@127.0.0.1:1/mealy';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function readJournalEntries(): JournalEntry[] {
  const journal = JSON.parse(
    fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf-8')
  ) as { entries: JournalEntry[] };
  return journal.entries;
}

async function countMigrations(sql: postgres.Sql = client): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    select count(*)::int as n from drizzle.__drizzle_migrations
  `;
  return rows[0].n;
}

describe('migrations journal', () => {
  it('lists migrations in strictly increasing order, one entry per SQL file', () => {
    // Il migratore applica solo le migrazioni con `when` maggiore dell'ultima applicata:
    // una voce fuori ordine verrebbe saltata in silenzio su un database già popolato.
    const entries = readJournalEntries();
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
      if (i > 0) expect(entry.when).toBeGreaterThan(entries[i - 1].when);
    });

    // Nei due sensi: un file .sql assente dal journal non verrebbe mai applicato.
    const sqlFiles = fs
      .readdirSync(MIGRATIONS_FOLDER)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => name.slice(0, -'.sql'.length))
      .sort();
    expect(sqlFiles).toEqual(entries.map((entry) => entry.tag).sort());
  });
});

describe('runDbBootstrap with an unreachable database', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives up after the configured attempts and rethrows the connection error', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      runDbBootstrap({ connectionString: UNREACHABLE_DATABASE, attempts: 2, delayMs: 10 })
    ).rejects.toThrow();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[bootstrap] database non ancora pronto (tentativo 1/2)');
  }, 30_000);

  it('paces the attempts with delayMs alone', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const startedAt = Date.now();

    await expect(
      runDbBootstrap({ connectionString: UNREACHABLE_DATABASE, attempts: 8, delayMs: 10 })
    ).rejects.toThrow();

    // Con l'attesa crescente di postgres-js otto tentativi richiedono più di 15 secondi.
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 30_000);
});

describe.skipIf(!dbUp)('runDbBootstrap on a migrated database', () => {
  beforeAll(async () => {
    await assertDbMigrated();
    // Su un database indietro di una migrazione runDbBootstrap la applicherebbe davvero, sotto
    // gli altri file di test in esecuzione: meglio fermarsi qui con un messaggio chiaro.
    if ((await countMigrations()) !== readJournalEntries().length) {
      throw new Error(
        'Database di sviluppo non allineato: esegui `pnpm db:migrate` prima dei test.'
      );
    }
  });

  it('applies nothing new and is idempotent', async () => {
    const migrationsBefore = await countMigrations();

    await runDbBootstrap({ attempts: 1 });
    const second = await runDbBootstrap({ attempts: 1 });

    expect(second).toEqual({ aliasesWritten: 0 });
    expect(await countMigrations()).toBe(migrationsBefore);
  });

  it('rejects when the migrations folder does not exist', async () => {
    await expect(
      runDbBootstrap({ attempts: 1, migrationsFolder: '/cartella/che/non/esiste' })
    ).rejects.toThrow(/_journal\.json/);
  });
});

describe.skipIf(!dbUp)('runDbBootstrap on a database one migration behind', () => {
  // Database usa-e-getta: quello di sviluppo, usato dagli altri file di test, non viene toccato.
  const databaseName = `mealy_bootstrap_${process.pid}_${Date.now()}`;
  const url = new URL(
    process.env.DATABASE_URL || 'postgresql://mealy:mealy@localhost:5432/mealy_dev'
  );
  url.pathname = `/${databaseName}`;
  const connectionString = url.toString();

  let scratch: postgres.Sql | undefined;
  let previousReleaseFolder: string | undefined;

  beforeAll(async () => {
    await client.unsafe(`create database "${databaseName}"`);
    scratch = postgres(connectionString, { max: 1, onnotice: () => {} });

    // Le migrazioni com'erano al rilascio precedente: il journal senza l'ultima voce.
    previousReleaseFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'mealy-migrations-'));
    fs.cpSync(MIGRATIONS_FOLDER, previousReleaseFolder, { recursive: true });
    const journalPath = path.join(previousReleaseFolder, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as {
      entries: JournalEntry[];
    };
    journal.entries.pop();
    fs.writeFileSync(journalPath, JSON.stringify(journal));
  }, 30_000);

  afterAll(async () => {
    await scratch?.end({ timeout: 5 });
    await client.unsafe(`drop database if exists "${databaseName}" with (force)`);
    if (previousReleaseFolder) fs.rmSync(previousReleaseFolder, { recursive: true, force: true });
  }, 30_000);

  it('applies the missing migration and loads the aliases', async () => {
    const total = readJournalEntries().length;
    await migrate(drizzle(scratch!), { migrationsFolder: previousReleaseFolder! });
    expect(await countMigrations(scratch)).toBe(total - 1);

    const report = await runDbBootstrap({ connectionString, attempts: 1 });

    expect(await countMigrations(scratch)).toBe(total);
    expect(report).toEqual({ aliasesWritten: FIXTURE_INGREDIENT_ALIASES.length });
  }, 30_000);
});
