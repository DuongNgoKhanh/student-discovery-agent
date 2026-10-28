import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from '../helpers/api';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { call, json, validateEnvelope } from '../helpers/users-api';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { closeProductDatabase, getProductDatabase } from '@/infrastructure/db/client';
import { issueAccessToken } from '@/modules/auth/tokens';
import { seedAgent } from '@/modules/agent/agent.service';

export const SEED = { greeting_text: 'Chào bạn!', allowed_activity_profiles: ['riasec.mean.bounds.v2'] };
let pg: PostgresHandle;
let admin: string;

beforeAll(async () => {
  pg = await startPostgres();
  await migrateProduct(pg.url);
  vi.stubEnv('DATABASE_URL', pg.url);
  vi.stubEnv('SECRET_KEY', 'integration-test-secret');
  await seedAgent(getProductDatabase(), SEED);
});
afterAll(async () => { try { await closeProductDatabase(); } finally { await pg?.stop(); } });
beforeEach(async () => {
  vi.stubEnv('DATABASE_URL', pg.url);
  vi.stubEnv('SECRET_KEY', 'integration-test-secret');
  admin = await issueAccessToken('admin', true);
});

const req = async (method: string, path: string, body?: unknown, token = admin) => {
  const res = await dispatch(call(method, path, token, body));
  const envelope = await json(res);
  expect(validateEnvelope(envelope)).toBe(true);
  return { status: res.status, body: envelope };
};

describe('agent draft API', () => {
  it('requires admin', async () => {
    const user = await issueAccessToken('7', false);
    expect((await req('GET', '/admin/agent/draft', undefined, user)).status).toBe(403);
  });

  it('reads the seeded draft and saves with revision', async () => {
    const read = await req('GET', '/admin/agent/draft');
    expect(read.body.data).toMatchObject({ content: SEED, revision: 1 });
    const saved = await req('PUT', '/admin/agent/draft', { content: { ...SEED, greeting_text: 'Xin chào' }, expected_revision: 1 });
    expect(saved.body.data.revision).toBe(2);
    const stale = await req('PUT', '/admin/agent/draft', { content: SEED, expected_revision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'CONFLICT_REVISION', details: { current: { revision: 2 } } });
  });

  it('rejects non-object content', async () => {
    expect((await req('PUT', '/admin/agent/draft', { content: [], expected_revision: 2 })).status).toBe(422);
  });
});
