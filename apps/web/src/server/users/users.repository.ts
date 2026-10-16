import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { ProductDatabase } from '../db/client';
import { users } from './users.table';
import type { NewUser, UserPatch, UserRow } from './users.types';

export async function findUserByEmail(db: ProductDatabase, email: string): Promise<UserRow | undefined> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email), eq(users.is_deleted, false)))
    .limit(1);
  return row;
}

export async function findUserById(
  db: ProductDatabase,
  id: number,
  includeDeleted = false,
): Promise<UserRow | undefined> {
  const where = includeDeleted ? eq(users.id, id) : and(eq(users.id, id), eq(users.is_deleted, false));
  const [row] = await db.select().from(users).where(where).limit(1);
  return row;
}

export async function insertUser(db: ProductDatabase, input: NewUser): Promise<UserRow> {
  const [row] = await db.insert(users).values(input).returning();
  if (!row) throw new Error('insertUser returned no row');
  return row;
}

const PATCHABLE = ['is_deleted', 'hashed_password', 'name', 'avatar_url', 'bio', 'position'] as const satisfies ReadonlyArray<
  keyof UserPatch
>;

/** Legacy `onupdate=func.now()` was ORM-side, so `updated_at` is set here from the DB clock. */
export async function updateUserRow(
  db: ProductDatabase,
  id: number,
  patch: UserPatch,
): Promise<UserRow | undefined> {
  // Copy only patchable keys so an untyped caller cannot rewrite id/email/created_at.
  const values: UserPatch = {};
  for (const key of PATCHABLE) {
    if (patch[key] !== undefined) Object.assign(values, { [key]: patch[key] });
  }
  const [row] = await db
    .update(users)
    .set({ ...values, updated_at: sql`now()` })
    .where(eq(users.id, id))
    .returning();
  return row;
}
