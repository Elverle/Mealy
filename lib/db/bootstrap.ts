import path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from './schema';
import { seedIngredientAliases } from './seed-core';

const DEFAULT_CONNECTION_STRING = 'postgresql://mealy:mealy@localhost:5432/mealy_dev';
const DEFAULT_ATTEMPTS = 30;
const DEFAULT_DELAY_MS = 2000;
const CONNECT_TIMEOUT_SECONDS = 5;

export interface DbBootstrapOptions {
  /** Default: `process.env.DATABASE_URL`, poi l'URL di sviluppo. */
  connectionString?: string;
  /** Default: `<cwd>/lib/db/migrations`. */
  migrationsFolder?: string;
  /** Tentativi di connessione prima di rinunciare. Default 30. */
  attempts?: number;
  /** Attesa tra due tentativi, in millisecondi. Default 2000. */
  delayMs?: number;
}

export interface DbBootstrapReport {
  /** Alias inseriti o corretti da questo avvio (0 se erano già allineati). */
  aliasesWritten: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prepara il database all'avvio in produzione: aspetta che Postgres risponda, applica le
 * migrazioni mancanti e carica gli alias degli ingredienti. Idempotente. Usa una connessione
 * propria, chiusa alla fine: non tocca il pool dell'app (`lib/db/index.ts`).
 */
export async function runDbBootstrap(options: DbBootstrapOptions = {}): Promise<DbBootstrapReport> {
  const connectionString =
    options.connectionString ?? (process.env.DATABASE_URL || DEFAULT_CONNECTION_STRING);
  const migrationsFolder =
    options.migrationsFolder ?? path.join(process.cwd(), 'lib', 'db', 'migrations');
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;

  const sql = postgres(connectionString, {
    max: 1,
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    onnotice: () => {},
  });

  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await sql`select 1`;
        break;
      } catch (err) {
        if (attempt >= attempts) throw err;
        console.log(`[bootstrap] database non ancora pronto (tentativo ${attempt}/${attempts})`);
        await sleep(delayMs);
      }
    }

    const bootstrapDb = drizzle(sql, { schema });
    await migrate(bootstrapDb, { migrationsFolder });
    const aliasesWritten = await seedIngredientAliases(bootstrapDb);
    return { aliasesWritten };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
