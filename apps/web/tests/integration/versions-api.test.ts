import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { call, json, route, validateEnvelope } from '../helpers/users-api';
import { migrateProduct } from '@/server/db/migrate';
import { closeProductDatabase } from '@/server/db/client';
import { GET, POST } from '@/app/api/v1/versions/route';

let pg: PostgresHandle;
beforeAll(async () => {
  pg = await startPostgres();
  await migrateProduct(pg.url);
});
afterAll(async () => {
  try {
    await closeProductDatabase();
  } finally {
    await pg?.stop();
  }
});
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('DATABASE_URL', pg.url);
  vi.stubEnv('SECRET_KEY', 'integration-test-secret');
});

describe('/versions', () => {
  it('GET with no current version -> 404; POST makes it current and deprecates the previous', async () => {
    expect((await GET(call('GET', '/versions'), route)).status).toBe(404);

    const first = await POST(call('POST', '/versions', undefined, { version: '1.0.0', description: 'first' }), route);
    expect(first.status).toBe(201);
    const second = await POST(call('POST', '/versions', undefined, { version: '1.1.0' }), route);
    expect(second.status).toBe(201);
    const body = await json(second);
    expect(validateEnvelope(body), JSON.stringify(validateEnvelope.errors)).toBe(true);
    expect(body.data).toMatchObject({ version: '1.1.0', is_current: true, is_deprecated: false });

    const cur = await json(await GET(call('GET', '/versions'), route));
    expect(cur.data.version).toBe('1.1.0');
  });

  it('duplicate -> 400, non-semver -> 422', async () => {
    await POST(call('POST', '/versions', undefined, { version: '2.0.0' }), route);
    expect((await POST(call('POST', '/versions', undefined, { version: '2.0.0' }), route)).status).toBe(400);
    expect((await POST(call('POST', '/versions', undefined, { version: 'v2' }), route)).status).toBe(422);
  });
});
