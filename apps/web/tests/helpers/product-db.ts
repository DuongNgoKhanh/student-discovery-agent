import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, type ClientBase } from 'pg';

/** Legacy DDL generated from the SQLModel models (tests/fixtures/legacy/generate.py). */
const legacySchemaSql = readFileSync(resolve(__dirname, '../fixtures/legacy/schema.sql'), 'utf8');

/** Each statement of schema.sql (`CREATE TABLE users ...`, `CREATE TABLE versions ...`). */
function legacyStatements(): Record<'users' | 'versions', string> {
  const statements = legacySchemaSql
    .replace(/^--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const pick = (table: string) => {
    const stmt = statements.find((s) => s.startsWith(`CREATE TABLE ${table} (`));
    if (!stmt) throw new Error(`schema.sql has no CREATE TABLE ${table}`);
    return stmt;
  };
  return { users: pick('users'), versions: pick('versions') };
}

/** Create legacy tables exactly as SQLModel `create_all` did, in `schema` (default public). */
export async function createLegacyTables(
  client: ClientBase,
  tables: Array<'users' | 'versions'>,
  schema = 'public',
): Promise<void> {
  const ddl = legacyStatements();
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  try {
    for (const t of tables) await client.query(ddl[t]);
  } finally {
    await client.query('RESET search_path');
  }
}

/** Create a fresh database inside the container and return its URL. */
export async function createDatabase(adminUrl: string, name: string): Promise<string> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

export async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export interface TableShape {
  columns: Array<{
    name: string;
    type: string;
    nullable: boolean;
    default: string | null;
  }>;
  constraints: string[];
  indexes: string[];
}

/** Structural description of a table with the schema name normalized out. */
export async function describeTable(client: ClientBase, schema: string, table: string): Promise<TableShape> {
  const strip = (s: string | null) => (s === null ? null : s.split(`${schema}.`).join(''));
  const cols = await client.query(
    `SELECT a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type,
            NOT a.attnotnull AS nullable,
            pg_get_expr(d.adbin, d.adrelid) AS "default"
       FROM pg_attribute a
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = format('%I.%I', $1::text, $2::text)::regclass
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [schema, table],
  );
  const cons = await client.query(
    `SELECT conname || ' ' || pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conrelid = format('%I.%I', $1::text, $2::text)::regclass
      ORDER BY conname`,
    [schema, table],
  );
  const idx = await client.query(
    `SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
    [schema, table],
  );
  return {
    columns: cols.rows.map((r) => ({ ...r, default: strip(r.default) })),
    constraints: cons.rows.map((r) => r.def as string),
    indexes: idx.rows.map((r) => strip(r.indexdef as string) as string),
  };
}

export async function regclass(client: ClientBase, name: string): Promise<string | null> {
  const r = await client.query('SELECT to_regclass($1)::text AS rel', [name]);
  return r.rows[0].rel;
}

export async function sequenceState(
  client: ClientBase,
  seq: string,
): Promise<{ last_value: string; is_called: boolean }> {
  const r = await client.query(`SELECT last_value::text AS last_value, is_called FROM ${seq}`);
  return r.rows[0];
}
