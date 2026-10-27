import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { vi } from 'vitest';

const RUNTIME_DIR = resolve(__dirname, '../../../agent-runtime');
const STUDIO_PASSWORD = 'studio-test-password';

export interface KnowledgeDbHandle {
  adminUrl: string;
  studioUrl: string;
  stop(): Promise<void>;
}

function provisionPython(): string {
  const configured = process.env.KNOWLEDGE_PROVISION_PYTHON;
  if (configured) return configured;
  const venv = resolve(RUNTIME_DIR, '.venv/bin/python');
  if (!existsSync(venv)) {
    throw new Error('Knowledge integration tests need apps/agent-runtime/.venv or KNOWLEDGE_PROVISION_PYTHON');
  }
  return venv;
}

/** pgvector Postgres with the runtime's knowledge schema and a real `kb_studio` login. Callers must `stop()`. */
export async function startKnowledgePostgres(): Promise<KnowledgeDbHandle> {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('sda_test')
    .withUsername('sda_test')
    .withPassword('sda_test')
    .start();
  const adminUrl = container.getConnectionUri();
  try {
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    try {
      await admin.query('CREATE ROLE kb_runtime NOLOGIN');
      await admin.query('CREATE ROLE kb_indexer NOLOGIN');
      await admin.query(`CREATE ROLE kb_studio LOGIN PASSWORD '${STUDIO_PASSWORD}'`);
    } finally {
      await admin.end();
    }
    execFileSync(provisionPython(), [
      '-m', 'agent_runtime.cli.knowledge_provision',
      '--runtime-role', 'kb_runtime', '--indexer-role', 'kb_indexer', '--studio-role', 'kb_studio',
    ], {
      cwd: RUNTIME_DIR,
      env: { ...process.env, RUNTIME_MIGRATION_DATABASE_URL: adminUrl.replace(/^postgres(ql)?:\/\//, 'postgresql+psycopg://') },
      stdio: 'pipe',
    });
  } catch (error) {
    await container.stop();
    throw error;
  }
  const studio = new URL(adminUrl);
  studio.username = 'kb_studio';
  studio.password = STUDIO_PASSWORD;
  return { adminUrl, studioUrl: studio.toString(), stop: async () => { await container.stop(); } };
}

/** Superuser SQL for simulating the indexer (index_status, active_revision_id) in tests. */
export async function adminSql(handle: KnowledgeDbHandle, text: string, params: unknown[] = []) {
  const client = new Client({ connectionString: handle.adminUrl });
  await client.connect();
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
}

export function stubKnowledgeEnv(handle: KnowledgeDbHandle, extra: Record<string, string> = {}) {
  vi.stubEnv('SECRET_KEY', 'integration-test-secret');
  vi.stubEnv('KNOWLEDGE_DATABASE_URL', handle.studioUrl);
  vi.stubEnv('KNOWLEDGE_EMBEDDING_MODELS', 'fake-embedding,gemini-embedding-2');
  for (const [name, value] of Object.entries(extra)) vi.stubEnv(name, value);
}
