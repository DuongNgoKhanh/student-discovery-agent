import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool, type ClientBase } from 'pg';
import legacy from '../fixtures/legacy/auth.json';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import {
  createDatabase,
  createLegacyTables,
  describeTable,
  regclass,
  sequenceState,
  withClient,
} from '../helpers/product-db';
import { createDatabase as createProductDatabase } from '@/infrastructure/db/client';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { insertUser } from '@/modules/users/users.repository';

const LEGACY_CREATED_AT = '2026-01-02T03:04:05.123456+07:00';

let pg: PostgresHandle;
let dbCounter = 0;

beforeAll(async () => {
  pg = await startPostgres();
});

afterAll(async () => {
  await pg?.stop();
});

async function freshDb(): Promise<string> {
  dbCounter += 1;
  return createDatabase(pg.url, `migration_case_${dbCounter}`);
}

async function seedLegacyUsers(c: ClientBase): Promise<void> {
  await c.query(
    `INSERT INTO public.users (id, created_at, updated_at, is_deleted, email, hashed_password, name, avatar_url, bio, position)
     VALUES (7, $1, NULL, false, 'argon@example.test', $2, 'Argon User', 'https://cdn.example.test/avatars/7.png', 'bio 7', 'Engineer'),
            (8, '2025-06-01T00:00:00Z', '2025-07-01T00:00:00Z', true, 'bcrypt@example.test', $3, 'Deleted User', NULL, NULL, NULL)`,
    [LEGACY_CREATED_AT, legacy.argon2_hash, legacy.bcrypt_hash],
  );
  await c.query(`SELECT setval('public.users_id_seq', 70, true)`);
}

async function seedLegacyVersions(c: ClientBase): Promise<void> {
  await c.query(
    `INSERT INTO public.versions (id, version, description, is_current, is_deprecated)
     VALUES (3, '1.0.0', 'first', false, true), (4, '1.1.0', NULL, true, false)`,
  );
  await c.query(`SELECT setval('public.versions_id_seq', 12, true)`);
}

async function dumpRows(c: ClientBase, qualified: string): Promise<string[]> {
  const r = await c.query(`SELECT row_to_json(t)::text AS j FROM ${qualified} t ORDER BY id`);
  return r.rows.map((row) => row.j as string);
}

async function journalCount(c: ClientBase): Promise<number | null> {
  if (!(await regclass(c, 'product.__drizzle_migrations'))) return null;
  const r = await c.query('SELECT count(*)::int AS n FROM product.__drizzle_migrations');
  return r.rows[0].n;
}

describe('Product migration', () => {
  it('creates product tables on an empty DB matching the legacy SQLModel DDL', async () => {
    const url = await freshDb();
    await migrateProduct(url);
    await withClient(url, async (c) => {
      expect(await regclass(c, 'public.users')).toBeNull();
      expect(await regclass(c, 'public.versions')).toBeNull();
      expect(await journalCount(c)).toBe(1);
      const execution = await c.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'execution'`);
      expect(execution.rowCount).toBe(0);

      // Reference: the exact legacy DDL loaded into a scratch schema.
      await createLegacyTables(c, ['users', 'versions'], 'ref');
      for (const table of ['users', 'versions']) {
        const product = await describeTable(c, 'product', table);
        const reference = await describeTable(c, 'ref', table);
        expect(product).toEqual(reference);
      }
      expect(await c.query(`SELECT pg_get_serial_sequence('product.users', 'id') AS s`)).toMatchObject({
        rows: [{ s: 'product.users_id_seq' }],
      });
    });
  });

  it('preserves_legacy_user_and_sequence', async () => {
    const url = await freshDb();
    const pool = new Pool({ connectionString: url });
    const product = createProductDatabase(url);
    const db = product.db;
    try {
      const client = await pool.connect();
      let usersBefore: string[];
      let versionsBefore: string[];
      try {
        await createLegacyTables(client, ['users', 'versions']);
        await seedLegacyUsers(client);
        await seedLegacyVersions(client);
        usersBefore = await dumpRows(client, 'public.users');
        versionsBefore = await dumpRows(client, 'public.versions');
        expect(await sequenceState(client, 'public.users_id_seq')).toEqual({
          last_value: '70',
          is_called: true,
        });
      } finally {
        client.release();
      }

      await migrateProduct(url);
      const result = await pool.query('SELECT id, hashed_password FROM product.users WHERE id = 7');
      expect(result.rows[0]).toEqual({ id: 7, hashed_password: legacy.argon2_hash });

      await withClient(url, async (c) => {
        expect(await regclass(c, 'public.users')).toBeNull();
        expect(await regclass(c, 'public.versions')).toBeNull();
        expect(await regclass(c, 'public.users_id_seq')).toBeNull();
        expect(await dumpRows(c, 'product.users')).toEqual(usersBefore);
        expect(await dumpRows(c, 'product.versions')).toEqual(versionsBefore);

        // Hashes byte-identical.
        const bytes = await c.query(
          `SELECT id, encode(convert_to(hashed_password, 'UTF8'), 'hex') AS hex FROM product.users ORDER BY id`,
        );
        expect(bytes.rows).toEqual([
          { id: 7, hex: Buffer.from(legacy.argon2_hash, 'utf8').toString('hex') },
          { id: 8, hex: Buffer.from(legacy.bcrypt_hash, 'utf8').toString('hex') },
        ]);

        // +07:00 instant preserved, soft-delete flag and avatar_url kept.
        const rows = await c.query(
          'SELECT id, created_at, is_deleted, avatar_url FROM product.users ORDER BY id',
        );
        expect((rows.rows[0].created_at as Date).toISOString()).toBe('2026-01-01T20:04:05.123Z');
        expect(rows.rows[0]).toMatchObject({ is_deleted: false, avatar_url: 'https://cdn.example.test/avatars/7.png' });
        expect(rows.rows[1]).toMatchObject({ is_deleted: true, avatar_url: null });
        const micro = await c.query(
          `SELECT created_at = $1::timestamptz AS same FROM product.users WHERE id = 7`,
          [LEGACY_CREATED_AT],
        );
        expect(micro.rows[0].same).toBe(true);

        // Sequence moved with the table, still owned by the column, state preserved.
        expect(await sequenceState(c, 'product.users_id_seq')).toEqual({ last_value: '70', is_called: true });
        expect(await sequenceState(c, 'product.versions_id_seq')).toEqual({ last_value: '12', is_called: true });
        const owned = await c.query(
          `SELECT pg_get_serial_sequence('product.users', 'id') AS u, pg_get_serial_sequence('product.versions', 'id') AS v`,
        );
        expect(owned.rows[0]).toEqual({ u: 'product.users_id_seq', v: 'product.versions_id_seq' });
        const shape = await describeTable(c, 'product', 'users');
        expect(shape.columns[0]).toMatchObject({ name: 'id', default: "nextval('users_id_seq'::regclass)" });
      });

      const inserted = await insertUser(db, { email: 'next@example.test' });
      expect(inserted.id).toBe(71);
      const version = await pool.query(
        `INSERT INTO product.versions (version, is_current, is_deprecated) VALUES ('2.0.0', false, false) RETURNING id`,
      );
      expect(version.rows[0].id).toBe(13);
    } finally {
      await product.close();
      await pool.end();
    }
  });

  it.each([['users'], ['versions']] as const)(
    'adopts a legacy DB that only has public.%s and creates the other table',
    async (present) => {
      const url = await freshDb();
      const missing = present === 'users' ? 'versions' : 'users';
      let before: string[] = [];
      await withClient(url, async (c) => {
        await createLegacyTables(c, [present]);
        if (present === 'users') await seedLegacyUsers(c);
        else await seedLegacyVersions(c);
        before = await dumpRows(c, `public.${present}`);
      });

      await migrateProduct(url);

      await withClient(url, async (c) => {
        expect(await regclass(c, `public.${present}`)).toBeNull();
        expect(await dumpRows(c, `product.${present}`)).toEqual(before);
        expect(await regclass(c, `product.${missing}`)).toBe(`product.${missing}`);
        expect(await dumpRows(c, `product.${missing}`)).toEqual([]);
        await createLegacyTables(c, [present, missing], 'ref');
        for (const t of [present, missing]) {
          expect(await describeTable(c, 'product', t)).toEqual(await describeTable(c, 'ref', t));
        }
      });
    },
  );

  it('is idempotent on an already migrated DB (sequential and concurrent reruns)', async () => {
    const url = await freshDb();
    await withClient(url, async (c) => {
      await createLegacyTables(c, ['users', 'versions']);
      await seedLegacyUsers(c);
      await seedLegacyVersions(c);
    });
    await Promise.all([migrateProduct(url), migrateProduct(url), migrateProduct(url)]);

    let snapshot: { users: string[]; versions: string[]; seq: unknown } | undefined;
    await withClient(url, async (c) => {
      expect(await journalCount(c)).toBe(1);
      snapshot = {
        users: await dumpRows(c, 'product.users'),
        versions: await dumpRows(c, 'product.versions'),
        seq: await sequenceState(c, 'product.users_id_seq'),
      };
    });

    await migrateProduct(url);
    await migrateProduct(url);

    await withClient(url, async (c) => {
      expect(await journalCount(c)).toBe(1);
      expect({
        users: await dumpRows(c, 'product.users'),
        versions: await dumpRows(c, 'product.versions'),
        seq: await sequenceState(c, 'product.users_id_seq'),
      }).toEqual(snapshot);
    });
  });

  it.each([['users'], ['versions']] as const)(
    'rejects atomically when both public.%s and product.%s exist',
    async (conflicting) => {
      const url = await freshDb();
      await withClient(url, async (c) => {
        await createLegacyTables(c, ['users', 'versions']);
        await seedLegacyUsers(c);
        await seedLegacyVersions(c);
        await createLegacyTables(c, [conflicting], 'product');
        if (conflicting === 'users') {
          await c.query(`INSERT INTO product.users (email, is_deleted) VALUES ('other@example.test', false)`);
        } else {
          await c.query(`INSERT INTO product.versions (version, is_current, is_deprecated) VALUES ('9.9.9', false, false)`);
        }
      });

      await expect(migrateProduct(url)).rejects.toThrow(/product ownership conflict/i);

      await withClient(url, async (c) => {
        // Nothing moved: both legacy tables still in public with their data and sequences.
        expect(await regclass(c, 'public.users')).toBe('users');
        expect(await regclass(c, 'public.versions')).toBe('versions');
        expect((await dumpRows(c, 'public.users')).length).toBe(2);
        expect((await dumpRows(c, 'public.versions')).length).toBe(2);
        expect(await sequenceState(c, 'public.users_id_seq')).toEqual({ last_value: '70', is_called: true });
        const other = conflicting === 'users' ? 'versions' : 'users';
        expect(await regclass(c, `product.${other}`)).toBeNull();
        expect((await dumpRows(c, `product.${conflicting}`)).length).toBe(1);
        // No journal row recorded.
        expect(await journalCount(c)).toBe(0);
      });
    },
  );
});
