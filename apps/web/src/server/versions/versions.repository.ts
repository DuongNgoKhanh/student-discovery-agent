import 'server-only';
import { eq, sql } from 'drizzle-orm';
import type { ProductDatabase } from '../db/client';
import { versions } from './versions.table';

export type VersionRow = typeof versions.$inferSelect;

export async function findCurrentVersion(db: ProductDatabase): Promise<VersionRow | undefined> {
  const [row] = await db.select().from(versions).where(eq(versions.is_current, true)).limit(1);
  return row;
}

/** One transaction: serialize via advisory lock, reject duplicates, deprecate current, insert the new current. */
export async function insertCurrentVersion(
  db: ProductDatabase,
  input: { version: string; description?: string | null },
): Promise<VersionRow | 'duplicate'> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('product.versions'))`);
    const [dup] = await tx.select({ id: versions.id }).from(versions).where(eq(versions.version, input.version)).limit(1);
    if (dup) return 'duplicate' as const;
    await tx
      .update(versions)
      .set({ is_current: false, is_deprecated: true, updated_at: sql`now()` })
      .where(eq(versions.is_current, true));
    const [row] = await tx
      .insert(versions)
      .values({ version: input.version, description: input.description ?? null, is_current: true, is_deprecated: false })
      .returning();
    if (!row) throw new Error('insert version returned no row');
    return row;
  });
}
