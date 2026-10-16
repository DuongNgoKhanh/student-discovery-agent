import { PostgreSqlContainer } from '@testcontainers/postgresql';

export interface PostgresHandle {
  url: string;
  stop(): Promise<void>;
}

/**
 * Disposable Postgres on a random mapped port. Never reads `.env` or any
 * user-provided DATABASE_URL; callers must `stop()` in a `finally`.
 */
export async function startPostgres(): Promise<PostgresHandle> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('sda_test')
    .withUsername('sda_test')
    .withPassword('sda_test')
    .start();
  return {
    url: container.getConnectionUri(),
    stop: async () => {
      await container.stop();
    },
  };
}
