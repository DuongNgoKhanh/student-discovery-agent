import { dispatch } from '../helpers/api';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { call, json, validateEnvelope } from '../helpers/users-api';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { closeProductDatabase, getProductDatabase } from '@/infrastructure/db/client';
import { issueAccessToken } from '@/modules/auth/tokens';
import { insertUser, findUserById } from '@/modules/users/users.repository';

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

  it('GET returns the profile without hash, validated against the envelope contract', async () => {
    const { row, token } = await seedUser('me-get@example.test');
    const body = await json(await getMe(call('GET', '/me', token)));
    expect(validateEnvelope(body), JSON.stringify(validateEnvelope.errors)).toBe(true);
    expect(body.data).toMatchObject({ id: row.id, email: 'me-get@example.test' });
  });

  it('PUT updates profile fields only; email/id/hash cannot be changed', async () => {
    const { row, token } = await seedUser('me-put@example.test');
    const res = await putMe(
      call('PUT', '/me', token, { name: 'New', bio: 'b', email: 'evil@example.test', id: 999, hashed_password: 'x', is_deleted: true }),
    );
    const body = await json(res);
    expect(body.data).toMatchObject({ id: row.id, email: 'me-put@example.test', name: 'New', bio: 'b' });
    const after = await findUserById(getProductDatabase(), row.id);
    expect(after).toMatchObject({ hashed_password: 'hash-secret', is_deleted: false });
  });

  it('without token -> 401', async () => {
    expect((await getMe(call('GET', '/me'))).status).toBe(401);
    expect((await putMe(call('PUT', '/me', undefined, { name: 'x' }))).status).toBe(401);
  });
});

describe('GET /users', () => {
  it('requires a user token and lists non-deleted users with pagination', async () => {
    const { token } = await seedUser('list-a@example.test');
    expect((await listUsers(call('GET', '/users'))).status).toBe(401);
    const body = await json(await listUsers(call('GET', '/users?limit=1&order_by=id&dir=desc', token)));
    expect(body.data.items).toHaveLength(1);
    expect(body.meta.pagination).toMatchObject({ limit: 1 });
    expect(body.meta.request_id).toEqual(expect.any(String));
    expect(Object.keys(body.data.items[0]).sort()).toEqual(['avatar_url', 'id', 'name', 'position']);
  });
});

describe('CSRF hardening', () => {
  it('text/plain POST to /auth/login -> 415', async () => {
    const res = await login(
      new Request('http://localhost/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"email":"a@b.co","password":"x"}' }),
    );
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe('VAL_UNSUPPORTED_MEDIA_TYPE');
  });
});

const getMe = dispatch;
const putMe = dispatch;
const listUsers = dispatch;
const login = dispatch;

it('public directory rejects private email and deletion filters', async () => {
  const { token } = await seedUser('directory-filter@example.test');
  expect((await dispatch(call('GET', '/users?email=directory-filter@example.test', token))).status).toBe(422);
  expect((await dispatch(call('GET', '/users?is_deleted=true', token))).status).toBe(422);
});

it('user cursors are bound to name filters and direction', async () => {
  const { token } = await seedUser('cursor-first@example.test', { name: 'Cursor Person' });
  await seedUser('cursor-second@example.test', { name: 'Cursor Person' });
  const first = await json(await dispatch(call('GET', '/users?limit=1&name=Cursor&dir=asc', token)));
  expect(first.meta.pagination.has_more).toBe(true);
  const cursor = encodeURIComponent(first.meta.pagination.next_cursor);
  const second = await json(await dispatch(call('GET', `/users?limit=1&name=Cursor&dir=asc&cursor=${cursor}`, token)));
  expect(second.data.items[0].id).not.toBe(first.data.items[0].id);
  expect((await dispatch(call('GET', `/users?name=Different&dir=asc&cursor=${cursor}`, token))).status).toBe(400);
  expect((await dispatch(call('GET', `/users?name=Cursor&dir=desc&cursor=${cursor}`, token))).status).toBe(400);
});
