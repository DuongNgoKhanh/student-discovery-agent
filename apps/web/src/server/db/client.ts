import 'server-only';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type ProductDatabase = NodePgDatabase<typeof schema>;

export interface ProductDatabaseHandle {
  db: ProductDatabase;
  pool: Pool;
  close(): Promise<void>;
}

/**
 * Build a Product DB handle. Lazy: `pg.Pool` opens no connection until the first query,
 * so importing or constructing this never touches the database.
 */
export function createDatabase(url: string): ProductDatabaseHandle {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  let closed: Promise<void> | undefined;
  return {
    db,
    pool,
    close: () => (closed ??= pool.end()),
  };
}
