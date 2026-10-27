import { Pool, type PoolClient } from 'pg';
import { getKnowledgeEnv } from '@/config/env';
import { ProductError } from '@/http/errors';

export type Queryable = Pick<PoolClient, 'query'>;

const globalHandle = globalThis as unknown as { __sdaKnowledgePool?: { url: string; pool: Pool } };

function unavailable(): ProductError {
  return new ProductError(503, 'SYS_UNAVAILABLE', 'Knowledge storage is unavailable', true, { kind: 'dependency_down' });
}

// Connection-level failures only; constraint or permission errors are real bugs and stay 500.
const UNAVAILABLE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', '57P01', '57P02', '57P03', '53300']);

// 57014 is statement_timeout; pg raises "Connection terminated ..." without a code when the socket drops mid-query.
export function mapDatabaseError(error: unknown): unknown {
  if (error instanceof ProductError) return error;
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && (UNAVAILABLE_CODES.has(code) || code === '57014' || code.startsWith('08'))) return unavailable();
  if (error instanceof Error && error.message.startsWith('Connection terminated')) return unavailable();
  return error;
}

/** Pool for the `kb_studio` role, which may write content columns of schema `knowledge` and nothing else. */
export function getKnowledgePool(): Pool {
  const notConfigured = () => new ProductError(503, 'SYS_UNAVAILABLE', 'Knowledge storage is not configured', false, { kind: 'not_configured' });
  let url: string | undefined;
  try {
    url = getKnowledgeEnv().KNOWLEDGE_DATABASE_URL;
  } catch (error) {
    console.error('[knowledge-db] invalid configuration', (error as Error).message);
    throw notConfigured();
  }
  if (!url) throw notConfigured();
  const current = globalHandle.__sdaKnowledgePool;
  if (current?.url === url) return current.pool;
  if (current) void current.pool.end().catch(() => {});
  const pool = new Pool({ connectionString: url, max: 5, statement_timeout: 10_000, connectionTimeoutMillis: 5_000 });
  pool.on('error', (error: Error) => {
    console.error('[knowledge-db] idle connection lost', error.name, (error as { code?: string }).code ?? '');
  });
  globalHandle.__sdaKnowledgePool = { url, pool };
  return pool;
}

export async function closeKnowledgePool(): Promise<void> {
  const current = globalHandle.__sdaKnowledgePool;
  globalHandle.__sdaKnowledgePool = undefined;
  await current?.pool.end();
}

async function connect(): Promise<PoolClient> {
  try {
    return await getKnowledgePool().connect();
  } catch (error) {
    if (error instanceof ProductError) throw error;
    // Never log the message: it may carry the host or connection URL.
    console.error('[knowledge-db] connect failed', (error as Error)?.name, (error as { code?: unknown })?.code);
    throw unavailable();
  }
}

// A client whose ROLLBACK failed is in an unknown state: release(error) destroys it instead of pooling it.
async function useClient<T>(fn: (client: PoolClient, discard: (reason: Error) => void) => Promise<T>): Promise<T> {
  const client = await connect();
  let discarded: Error | undefined;
  try {
    return await fn(client, (reason) => { discarded = reason; });
  } catch (error) {
    throw mapDatabaseError(error);
  } finally {
    client.release(discarded);
  }
}

export async function withKnowledgeClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return useClient((client) => fn(client));
}

export async function inKnowledgeTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return useClient(async (client, discard) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch((rollbackError: unknown) => {
        discard(rollbackError instanceof Error ? rollbackError : new Error('ROLLBACK failed'));
      });
      throw error;
    }
  });
}
