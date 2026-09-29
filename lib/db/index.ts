import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString =
  process.env.DATABASE_URL || 'postgresql://mealy:mealy@localhost:5432/mealy_dev';

// Global singleton for connection pooling and Next.js HMR preservation
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

export const client = globalForDb.conn ?? postgres(connectionString);
if (process.env.NODE_ENV !== 'production') globalForDb.conn = client;

export const db = drizzle(client, { schema });
export type Database = typeof db;
type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Il `db` globale oppure una transazione: primo argomento dei repository. */
export type DbExecutor = Database | DbTransaction;
export * from './schema';
