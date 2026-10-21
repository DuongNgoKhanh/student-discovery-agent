import { and, asc, desc, eq, gt, lt, ilike, type SQL } from 'drizzle-orm';
import type { components } from '@/generated/api/admin-api';
import type { ProductDatabase } from '@/infrastructure/db/client';
import { hashPassword } from '@/modules/auth/password';
import { ProductError, transportError } from '@/http/errors';
import { encodeCursor, decodeCursor } from '@/modules/experiences/cursor';
import type { RequestContext } from '@/http/types';
import { toAdminProfile, type AdminUserProfile } from '@/modules/users/users.profile';
import { findUserById, insertUser, updateUserRow } from '@/modules/users/users.repository';
import type { AdminCreateInput, AdminUpdateInput, UserQuery } from '@/modules/users/users.schemas';
import { users } from '@/modules/users/users.table';
import type { NewUser, UserPatch } from '@/modules/users/users.types';

type Bulk = components['schemas']['AdminUserBulkResponse'];
type BulkItem = components['schemas']['AdminUserBulkResult'];
type PaginationMeta = { limit: number; next_cursor: string | null; has_more: boolean };
/** Bulk response minus the HTTP envelope fields (`status`, `error`, `meta`), which the route adds. */
export type BulkOutcome = Omit<Bulk, 'status' | 'error' | 'meta' | 'total_processed' | 'total_success' | 'total_failed'> & { summary: { total_processed: number; total_success: number; total_failed: number } };

const notFound = () => new ProductError(404, 'RES_USER_NOT_FOUND', 'User not found');
const emailTaken = () => new ProductError(409, 'CONFLICT_EMAIL_EXISTS', 'Email is already registered');

export function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}

export async function createUser(db: ProductDatabase, input: NewUser): Promise<AdminUserProfile> {
  try {
    return toAdminProfile(await insertUser(db, input));
  } catch (error) {
    // Concurrent create, or a soft-deleted row still holding the unique email.
    if (isUniqueViolation(error)) throw emailTaken();
    throw error;
  }
}

export async function updateUser(db: ProductDatabase, id: number, patch: UserPatch): Promise<AdminUserProfile> {
  const row = await updateUserRow(db, id, patch);
  if (!row) throw notFound();
  return toAdminProfile(row);
}

export async function listUsers(
  db: ProductDatabase,
  query: UserQuery,
  includeDeleted = false,
): Promise<{ data: AdminUserProfile[]; pagination: PaginationMeta }> {
  const conds: SQL[] = [];
  if (!includeDeleted) conds.push(eq(users.is_deleted, false));
  else if (query.is_deleted !== undefined) conds.push(eq(users.is_deleted, query.is_deleted));
  const like = (v: string) => `%${v.replace(/[\\%_]/g, '\\$&')}%`;
  if (query.name) conds.push(ilike(users.name, like(query.name)));
  if (query.email) conds.push(ilike(users.email, like(query.email)));
  if (query.position) conds.push(eq(users.position, query.position));
  const scope = JSON.stringify({ collection: 'users', includeDeleted, name: query.name ?? null,
    email: query.email ?? null, position: query.position ?? null, is_deleted: query.is_deleted ?? null,
    order_by: query.order_by, dir: query.dir });
  if (query.cursor) {
    const id = decodeCursor(query.cursor, scope);
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Invalid pagination cursor');
    conds.push(query.dir === 'asc' ? gt(users.id, id) : lt(users.id, id));
  }
  const rows = await db.select().from(users).where(and(...conds))
    .orderBy(query.dir === 'asc' ? asc(users.id) : desc(users.id)).limit(query.limit + 1);
  const has_more = rows.length > query.limit;
  if (has_more) rows.pop();
  return { data: rows.map(toAdminProfile), pagination: {
    limit: query.limit, has_more,
    next_cursor: has_more ? encodeCursor(scope, rows[rows.length - 1]!.id) : null,
  } };
}

export async function softDeleteUser(db: ProductDatabase, id: number): Promise<void> {
  const row = await findUserById(db, id);
  if (!row) throw notFound();
  await updateUserRow(db, id, { is_deleted: true });
}

export async function restoreUser(db: ProductDatabase, id: number): Promise<AdminUserProfile> {
  if (!(await findUserById(db, id, true))) throw notFound();
  return updateUser(db, id, { is_deleted: false });
}

/** Admin patch -> repository patch (hashes `password`, drops nulls for non-nullable columns). */
export async function toPatch(input: AdminUpdateInput): Promise<UserPatch> {
  const { password, is_deleted, ...profile } = input;
  const patch: UserPatch = { ...profile };
  if (password) patch.hashed_password = await hashPassword(password);
  if (is_deleted != null) patch.is_deleted = is_deleted;
  return patch;
}

export async function toNewUser(input: AdminCreateInput): Promise<NewUser> {
  const { password, ...rest } = input;
  return { ...rest, hashed_password: password ? await hashPassword(password) : null };
}

// ---- bulk: each item is an independent statement, so one failure never aborts the rest ----

function errorOf(e: unknown) {
  if (e instanceof ProductError) return transportError(e);
  console.error('[users] bulk item failed', e);
  return transportError(new ProductError(500, 'INTERNAL_ERROR', 'Internal server error'));
}

async function runBulk<T>(items: T[], op: (item: T) => Promise<number>, idOf: (item: T) => number | null, ctx?: RequestContext): Promise<BulkOutcome> {
  const data: BulkItem[] = [];
  for (const item of items) {
    const meta = () => ({
      request_id: ctx?.requestId ?? crypto.randomUUID(),
      trace_id: ctx?.traceId ?? crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    });
    try {
      data.push({ success: true, user_id: await op(item), data: null, error: null, status: 200, meta: meta() });
    } catch (e) {
      const { error, status } = errorOf(e);
      data.push({ success: false, user_id: idOf(item), data: null, error: { ...error, details: null }, status, meta: meta() });
    }
  }
  const total_success = data.filter((d) => d.success).length;
  const total_failed = data.length - total_success;
  return {
    success: total_failed === 0,
    message: total_failed === 0 ? 'Operation successful' : 'Operation completed with errors',
    data,
    summary: { total_processed: data.length, total_success, total_failed },
  };
}

export function bulkCreateUsers(db: ProductDatabase, items: AdminCreateInput[], ctx?: RequestContext) {
  return runBulk(items, async (item) => (await createUser(db, await toNewUser(item))).id, () => null, ctx);
}

export function bulkUpdateUsers(
  db: ProductDatabase,
  items: { id: number; updates: AdminUpdateInput }[],
  ctx?: RequestContext,
) {
  return runBulk(items, async (item) => (await updateUser(db, item.id, await toPatch(item.updates))).id, (i) => i.id, ctx);
}

export function bulkDeleteUsers(db: ProductDatabase, ids: number[], ctx?: RequestContext) {
  return runBulk(ids, async (id) => (await softDeleteUser(db, id), id), (id) => id, ctx);
}
