import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import legacy from '../fixtures/legacy/auth.json';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { createDatabase, type ProductDatabaseHandle } from '@/infrastructure/db/client';
import { migrateProduct } from '@/infrastructure/db/migrate';
import {
  findUserByEmail,
  findUserById,
  insertUser,
  updateUserRow,
} from '@/modules/users/users.repository';
import type { NewUser, UserPatch, UserRow } from '@/modules/users/users.types';

let pg: PostgresHandle;
let handle: ProductDatabaseHandle;

beforeAll(async () => {
  pg = await startPostgres();
  await migrateProduct(pg.url);
  handle = createDatabase(pg.url);
});

afterAll(async () => {
  try {
    await handle?.close();
  } finally {
    await pg?.stop();
  }
});

describe('users repository', () => {
  it('inserts with legacy defaults and returns the full row', async () => {
    const before = Date.now();
    const user = await insertUser(handle.db, {
      email: 'insert@example.test',
      hashed_password: legacy.argon2_hash,
      name: 'Insert',
    });
    expect(user).toMatchObject({
      email: 'insert@example.test',
      hashed_password: legacy.argon2_hash,
      name: 'Insert',
      is_deleted: false,
      avatar_url: null,
      bio: null,
      position: null,
    });
    expect(user.id).toBeGreaterThan(0);
    expect(user.created_at).toBeInstanceOf(Date);
    expect(user.created_at.getTime()).toBeGreaterThan(before - 60_000);
    expect(user.updated_at).toEqual(user.created_at);
  });

  it('rejects a duplicate email via the unique constraint', async () => {
    await insertUser(handle.db, { email: 'dup@example.test' });
    await expect(insertUser(handle.db, { email: 'dup@example.test' })).rejects.toThrow();
  });

  it('findUserByEmail only returns non-deleted users', async () => {
    const alive = await insertUser(handle.db, { email: 'alive@example.test' });
    const gone = await insertUser(handle.db, { email: 'gone@example.test', is_deleted: true });
    expect((await findUserByEmail(handle.db, 'alive@example.test'))?.id).toBe(alive.id);
    expect(await findUserByEmail(handle.db, 'gone@example.test')).toBeUndefined();
    expect(await findUserByEmail(handle.db, 'missing@example.test')).toBeUndefined();
    expect(gone.is_deleted).toBe(true);
  });

  it('findUserById hides soft-deleted users unless includeDeleted', async () => {
    const gone = await insertUser(handle.db, { email: 'byid-gone@example.test', is_deleted: true });
    expect(await findUserById(handle.db, gone.id)).toBeUndefined();
    expect((await findUserById(handle.db, gone.id, true))?.email).toBe('byid-gone@example.test');
    expect(await findUserById(handle.db, 999_999, true)).toBeUndefined();
  });

  it('updateUserRow patches fields and sets updated_at from the database clock', async () => {
    const user = await insertUser(handle.db, { email: 'patch@example.test' });
    const dbNow = await handle.pool.query('SELECT now() AS now');
    const updated = await updateUserRow(handle.db, user.id, {
      name: 'Patched',
      avatar_url: 'https://cdn.example.test/a.png',
      bio: 'hello',
      position: 'PM',
    });
    expect(updated).toMatchObject({
      id: user.id,
      email: 'patch@example.test',
      name: 'Patched',
      avatar_url: 'https://cdn.example.test/a.png',
      bio: 'hello',
      position: 'PM',
    });
    expect(updated?.created_at.getTime()).toBe(user.created_at.getTime());
    expect(updated?.updated_at).toBeInstanceOf(Date);
    expect(updated!.updated_at!.getTime()).toBeGreaterThanOrEqual((dbNow.rows[0].now as Date).getTime());

    const softDeleted = await updateUserRow(handle.db, user.id, { is_deleted: true });
    expect(softDeleted?.is_deleted).toBe(true);
    expect(await findUserByEmail(handle.db, 'patch@example.test')).toBeUndefined();
  });

  it('updateUserRow returns undefined for an unknown id', async () => {
    expect(await updateUserRow(handle.db, 999_999, { name: 'x' })).toBeUndefined();
  });

  it('createDatabase does not connect until first query', async () => {
    const lazy = createDatabase('postgres://nobody:secret@127.0.0.1:1/none');
    expect(lazy.pool.totalCount).toBe(0);
    await lazy.close();
  });

  it('types: UserPatch excludes identity fields; UserRow mirrors legacy columns', () => {
    expectTypeOf<UserPatch>().not.toHaveProperty('id');
    expectTypeOf<UserPatch>().not.toHaveProperty('email');
    expectTypeOf<UserPatch>().not.toHaveProperty('created_at');
    expectTypeOf<NewUser>().not.toHaveProperty('id');
    expectTypeOf<UserRow>().toEqualTypeOf<{
      id: number;
      created_at: Date;
      updated_at: Date;
      is_deleted: boolean;
      email: string;
      hashed_password: string | null;
      name: string | null;
      avatar_url: string | null;
      bio: string | null;
      position: string | null;
    }>();
  });
});
