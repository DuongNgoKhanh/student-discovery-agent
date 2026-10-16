import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getProductEnv } from '@/config/env';
import * as schema from '@/infrastructure/db/schema';

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

// Process-wide handle for route handlers, created on first use from DATABASE_URL.
// Kept on globalThis so Next dev HMR does not leak pools.
const globalHandle = globalThis as unknown as { __sdaProductDb?: { url: string; handle: ProductDatabaseHandle } };

/** Shared Product DB for route handlers. Re-created if DATABASE_URL changes (tests). */
export function getProductDatabase(): ProductDatabase {
  const url = getProductEnv().DATABASE_URL;
  const current = globalHandle.__sdaProductDb;
  if (current && current.url === url) return current.handle.db;
  if (current) void current.handle.close();
  const handle = createDatabase(url);
  globalHandle.__sdaProductDb = { url, handle };
  return handle.db;
}

/** Close the shared handle (tests / graceful shutdown). */
export async function closeProductDatabase(): Promise<void> {
  const current = globalHandle.__sdaProductDb;
  globalHandle.__sdaProductDb = undefined;
  await current?.handle.close();
}
