import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { call, json, route, validateEnvelope } from '../helpers/users-api';
import { migrateProduct } from '@/server/db/migrate';
import { closeProductDatabase, getProductDatabase } from '@/server/db/client';
import { issueAccessToken } from '@/server/auth/tokens';
import { insertUser, findUserById } from '@/server/users/users.repository';
import { GET as getMe, PUT as putMe } from '@/app/api/v1/me/route';
import { GET as listUsers } from '@/app/api/v1/users/route';
import { POST as login } from '@/app/api/v1/auth/login/route';
import * as meModule from '@/app/api/v1/me/route';

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

async function seedUser(email: string, extra: Record<string, unknown> = {}) {
  const row = await insertUser(getProductDatabase(), { email, hashed_password: 'hash-secret', name: 'Seed', ...extra } as never);
  return { row, token: await issueAccessToken(String(row.id)) };
}

describe('/me', () => {
  it('declares the node runtime', () => expect(meModule.runtime).toBe('nodejs'));

  it('GET returns the profile without hash, validated against the envelope contract', async () => {
    const { row, token } = await seedUser('me-get@example.test');
    const body = await json(await getMe(call('GET', '/me', token), route));
    expect(validateEnvelope(body), JSON.stringify(validateEnvelope.errors)).toBe(true);
    expect(body.data).toMatchObject({ id: row.id, email: 'me-get@example.test' });
  });

  it('PUT updates profile fields only; email/id/hash cannot be changed', async () => {
    const { row, token } = await seedUser('me-put@example.test');
    const res = await putMe(
      call('PUT', '/me', token, { name: 'New', bio: 'b', email: 'evil@example.test', id: 999, hashed_password: 'x', is_deleted: true }),
      route,
    );
    const body = await json(res);
    expect(body.data).toMatchObject({ id: row.id, email: 'me-put@example.test', name: 'New', bio: 'b' });
    const after = await findUserById(getProductDatabase(), row.id);
    expect(after).toMatchObject({ hashed_password: 'hash-secret', is_deleted: false });
  });

  it('without token -> 401', async () => {
    expect((await getMe(call('GET', '/me'), route)).status).toBe(401);
    expect((await putMe(call('PUT', '/me', undefined, { name: 'x' }), route)).status).toBe(401);
  });
});

describe('GET /users', () => {
  it('requires a user token and lists non-deleted users with pagination', async () => {
    const { token } = await seedUser('list-a@example.test');
    expect((await listUsers(call('GET', '/users'), route)).status).toBe(401);
    const body = await json(await listUsers(call('GET', '/users?limit=1&order_by=bogus&dir=sideways', token), route));
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toMatchObject({ page: 1, limit: 1 });
    expect(body.data[0]).not.toHaveProperty('is_deleted');
  });
});

describe('CSRF hardening', () => {
  it('text/plain POST to /auth/login -> 415', async () => {
    const res = await login(
      new Request('http://localhost/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"email":"a@b.co","password":"x"}' }),
      route,
    );
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe('VAL_UNSUPPORTED_MEDIA_TYPE');
  });
});
