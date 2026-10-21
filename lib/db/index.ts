import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL || 'postgresql://mealy:mealy@localhost:5432/mealy_dev';

// Global singleton for connection pooling and Next.js HMR preservation
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

// Un solo pool per processo, anche se Next carica il modulo da più grafi (l'hook di avvio e le rotte) o lo ricarica con l'HMR.
globalForDb.conn ??= postgres(connectionString);
export const client = globalForDb.conn;

export const db = drizzle(client, { schema });
export type Database = typeof db;
type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Il `db` globale oppure una transazione: primo argomento dei repository. */
export type DbExecutor = Database | DbTransaction;
export * from './schema';
