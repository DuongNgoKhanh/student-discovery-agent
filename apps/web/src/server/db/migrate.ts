import 'server-only';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';

/** Drizzle journal (`product.__drizzle_migrations`) lives next to the tables it governs. */
export const MIGRATIONS_SCHEMA = 'product';
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../migrations', import.meta.url));

/**
 * Session-level advisory lock key serializing concurrent migration runs. Drizzle's pg migrator
 * takes no lock of its own, so every run holds this on its single dedicated connection.
 */
const MIGRATION_LOCK_KEY = 7_241_003_001;

/**
 * Apply pending Product migrations. Runs only when called (never on import / `next build`).
 * Drizzle executes all pending migrations plus their journal inserts in ONE transaction, so a
 * failing migration leaves tables and journal unchanged.
 */
export async function migrateProduct(url: string): Promise<void> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await migrate(drizzle(client), {
        migrationsFolder: MIGRATIONS_FOLDER,
        migrationsSchema: MIGRATIONS_SCHEMA,
      });
    } finally {
      // If unlock fails the connection is unusable; `client.end()` below drops the session and
      // with it the lock, so do not let an unlock error mask the migration's own error.
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    await client.end();
  }
}

/** Remove the connection string and its password from a message before logging. */
export function redact(message: string, url: string): string {
  let out = message.split(url).join('[DATABASE_URL]');
  try {
    const password = decodeURIComponent(new URL(url).password);
    if (password) out = out.split(password).join('[REDACTED]');
  } catch {
    // Unparseable URL: the whole-string replacement above is all we can do.
  }
  return out;
}

async function main(): Promise<void> {
  // Explicit environment of the runner only; no .env loading and never logged.
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('db:migrate: DATABASE_URL is required');
    process.exitCode = 1;
    return;
  }
  try {
    await migrateProduct(url);
    console.log('db:migrate: Product migrations applied');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`db:migrate: failed: ${redact(message, url)}`);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) void main();
