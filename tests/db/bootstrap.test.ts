// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { isDbAvailable, assertDbMigrated } from '@/tests/helpers/db';
import { runDbBootstrap } from '@/lib/db/bootstrap';
import { client } from '@/lib/db';

const dbUp = await isDbAvailable();

const MIGRATIONS_FOLDER = path.join(process.cwd(), 'lib', 'db', 'migrations');

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

async function countMigrations(): Promise<number> {
  const rows = await client<{ n: number }[]>`
    select count(*)::int as n from drizzle.__drizzle_migrations
  `;
  return rows[0].n;
}

describe('migrations journal', () => {
  it('lists migrations in strictly increasing order, each with its SQL file', () => {
    // Il migratore applica solo le migrazioni con `when` maggiore dell'ultima applicata:
    // una voce fuori ordine verrebbe saltata in silenzio su un database già popolato.
    const entries = readJournalEntries();
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((entry, i) => {
      expect(entry.idx).toBe(i);
      expect(fs.existsSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`))).toBe(true);
      if (i > 0) expect(entry.when).toBeGreaterThan(entries[i - 1].when);
    });
  });
});

describe('runDbBootstrap with an unreachable database', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gives up after the configured attempts and rethrows the connection error', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(
      runDbBootstrap({
        // Porta 1: nessun Postgres in ascolto, la connessione viene rifiutata.
        connectionString: 'postgresql://mealy:mealy@127.0.0.1:1/mealy',
        attempts: 2,
        delayMs: 10,
      })
    ).rejects.toThrow();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[bootstrap] database non ancora pronto (tentativo 1/2)');
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
    ).rejects.toThrow();
  });
});
