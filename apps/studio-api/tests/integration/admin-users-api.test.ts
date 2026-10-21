import { dispatch } from '../helpers/api';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { call, json, validateEnvelope } from '../helpers/users-api';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { closeProductDatabase, getProductDatabase } from '@/infrastructure/db/client';
import { issueAccessToken } from '@/modules/auth/tokens';
import { insertUser } from '@/modules/users/users.repository';
import { bulkCreateUsers } from '@/modules/users/users.service';

let pg: PostgresHandle;
let admin: string;
let userToken: string;
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
beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv('DATABASE_URL', pg.url);
  vi.stubEnv('SECRET_KEY', 'integration-test-secret');
  admin = await issueAccessToken('admin', true);
  const u = await insertUser(getProductDatabase(), { email: `plain-${Date.now()}-${Math.random()}@example.test`, hashed_password: null });
  userToken = await issueAccessToken(String(u.id));
});

describe('admin users CRUD', () => {
  it('create, get, list, update, soft delete, restore', async () => {
    const created = await json(await create(call('POST', '/admin/users', admin, { email: 'crud@example.test', password: 'Str0ng!Pass', name: 'Crud' })));
    expect(validateEnvelope(created), JSON.stringify(validateEnvelope.errors)).toBe(true);
    const id = created.data.id as number;
    expect(created.data).toMatchObject({ email: 'crud@example.test', is_deleted: false });

    expect((await json(await get(call('GET', `/admin/users/${id}`, admin)))).data.name).toBe('Crud');
    const updated = await json(await put(call('PUT', `/admin/users/${id}`, admin, { name: 'Renamed', password: 'N3w!Passw0rd' })));
    expect(updated.data.name).toBe('Renamed');

    expect((await del(call('DELETE', `/admin/users/${id}`, admin))).status).toBe(200);
    const filtered = await json(await list(call('GET', '/admin/users?is_deleted=true&email=crud@', admin)));
    expect(filtered.data.items.map((u: { id: number }) => u.id)).toEqual([id]);
    expect(filtered.meta.pagination.has_more).toBe(false);

    const restored = await json(await restore(call('POST', `/admin/users/${id}/restore`, admin)));
    expect(restored.data.is_deleted).toBe(false);
    expect((await get(call('GET', '/admin/users/999999', admin))).status).toBe(404);
  });

  it('user token -> 403, no token -> 401 on admin routes', async () => {
    const body = { email: 'nope@example.test' };
    expect((await create(call('POST', '/admin/users', userToken, body))).status).toBe(403);
    expect((await put(call('PUT', '/admin/users/1', userToken, {}))).status).toBe(403);
    expect((await del(call('DELETE', '/admin/users/1', userToken))).status).toBe(403);
    expect((await bulkDelete(call('DELETE', '/admin/users', userToken, { user_ids: [1] }))).status).toBe(403);
    expect((await bulkUpdate(call('PUT', '/admin/users/bulk/update', userToken, { users: [] }))).status).toBe(403);
    expect((await list(call('GET', '/admin/users'))).status).toBe(401);
  });
});

describe('bulk', () => {
  it('continues_bulk_after_unique_violation', async () => {
    const db = getProductDatabase();
    await insertUser(db, { email: 'exists@example.test', hashed_password: null });
    const result = await bulkCreateUsers(db, [{ email: 'exists@example.test' }, { email: 'new@example.test' }]);
    expect(result).toMatchObject({ success: false, summary: { total_processed: 2, total_success: 1, total_failed: 1 } });
    expect(result.data[0]).toMatchObject({ success: false, user_id: null, data: null });
    expect(result.data[1]?.success).toBe(true);
  });

  it('bulk routes return per-item results in contract shape', async () => {
    const res = await bulkCreate(
      call('POST', '/admin/users/bulk/create', admin, { users: [{ email: 'b1@example.test' }, { email: 'b1@example.test' }, { email: 'b2@example.test' }] }),
    );
    const body = await json(res);
    expect(body).toMatchObject({ success: false, meta: { summary: { total_processed: 3, total_success: 2, total_failed: 1 } }, status: 200 });
    const [ok, dup, ok2] = body.data;
    expect([ok.success, dup.success, ok2.success]).toEqual([true, false, true]);
    expect(dup).toMatchObject({ user_id: null, data: null, error: { code: 'CONFLICT_EMAIL_EXISTS' } });

    const upd = await json(
      await bulkUpdate(call('PUT', '/admin/users/bulk/update', admin, { users: [{ id: ok.user_id, updates: { name: 'X' } }, { id: 999999, updates: {} }] })),
    );
    expect(upd).toMatchObject({ success: false, meta: { summary: { total_success: 1, total_failed: 1 } } });
    expect(upd.data[1]).toMatchObject({ user_id: 999999, data: null });

    const delRes = await json(await bulkDelete(call('DELETE', '/admin/users', admin, { user_ids: [ok.user_id, 999999] })));
    expect(delRes).toMatchObject({ success: false, meta: { summary: { total_processed: 2, total_success: 1, total_failed: 1 } } });
  });
});

const list = dispatch;
const create = dispatch;
const bulkDelete = dispatch;
const get = dispatch;
const put = dispatch;
const del = dispatch;
const restore = dispatch;
const bulkCreate = dispatch;
const bulkUpdate = dispatch;

it('duplicate admin-created email returns a 409 conflict', async () => {
  const body = { email: 'duplicate409@example.test' };
  expect((await dispatch(call('POST', '/admin/users', admin, body))).status).toBe(200);
  const duplicate = await dispatch(call('POST', '/admin/users', admin, body));
  expect(duplicate.status).toBe(409);
  expect((await duplicate.json()).error.code).toBe('CONFLICT_EMAIL_EXISTS');
});
