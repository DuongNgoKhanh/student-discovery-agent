import { and, desc, eq, sql } from 'drizzle-orm';
import type { ProductDatabase } from '@/infrastructure/db/client';
import { ProductError } from '@/http/errors';
import {
  experienceDrafts,
  experienceReleases,
  experiences,
  idempotencyRecords,
} from '@/infrastructure/db/schema';
import { computeContentHash } from '@/modules/experiences/canonical';
import { encodeCursor, decodeCursor } from '@/modules/experiences/cursor';
import { resourceIdSchema } from '@/modules/experiences/experiences.schemas';

type ProductTransaction = Parameters<Parameters<ProductDatabase['transaction']>[0]>[0];
/** The pool-backed database or an open transaction; repository calls join whichever they receive. */
export type ProductExecutor = ProductDatabase | ProductTransaction;

export type ExperienceRow = typeof experiences.$inferSelect;
export type ExperienceDraftRow = typeof experienceDrafts.$inferSelect;
export type ExperienceReleaseRow = typeof experienceReleases.$inferSelect;
export type IdempotencyRecordRow = typeof idempotencyRecords.$inferSelect;

export interface ExperienceCursor {
  created_at: string;
  id: string;
}

export interface ReleaseCursor {
  published_at: string;
  id: string;
}

// Cursor timestamps keep PostgreSQL's microsecond precision: a millisecond JS Date would make
// keyset pagination skip rows that share the boundary millisecond.
const CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

function isCursorTimestamp(value: unknown): value is string {
  return typeof value === 'string' && CURSOR_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function isCursorId(value: unknown): value is string {
  return resourceIdSchema.safeParse(value).success;
}

/** Microsecond-precision UTC text for a timestamptz column, used as the keyset cursor value. */
function cursorTimestamp(column: typeof experiences.created_at | typeof experienceReleases.published_at) {
  return sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

export function encodeExperienceCursor(cursor: { created_at: Date | string; id: string }): string {
  const d = typeof cursor.created_at === 'string' ? cursor.created_at : cursor.created_at.toISOString();
  return encodeCursor('experiences:created_at:desc', { created_at: d, id: cursor.id });
}

export function decodeExperienceCursor(cursorStr: string): ExperienceCursor {
  try {
    const parsed = decodeCursor(cursorStr, 'experiences:created_at:desc') as ExperienceCursor;
    if (!parsed || !isCursorTimestamp(parsed.created_at) || !isCursorId(parsed.id)) {
      throw new Error('Malformed cursor');
    }
    return { created_at: parsed.created_at, id: parsed.id };
  } catch {
    throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Invalid pagination cursor');
  }
}

export function encodeReleaseCursor(cursor: { published_at: Date | string; id: string }, experienceId = ''): string {
  const d = typeof cursor.published_at === 'string' ? cursor.published_at : cursor.published_at.toISOString();
  return encodeCursor(`releases:${experienceId}:published_at:desc`, { published_at: d, id: cursor.id });
}

export function decodeReleaseCursor(cursorStr: string, experienceId = ''): ReleaseCursor {
  try {
    const parsed = decodeCursor(cursorStr, `releases:${experienceId}:published_at:desc`) as ReleaseCursor;
    if (!parsed || !isCursorTimestamp(parsed.published_at) || !isCursorId(parsed.id)) {
      throw new Error('Malformed cursor');
    }
    return { published_at: parsed.published_at, id: parsed.id };
  } catch {
    throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Invalid pagination cursor');
  }
}

export async function findExperienceById(
  db: ProductExecutor,
  id: string,
): Promise<ExperienceRow | undefined> {
  const [row] = await db.select().from(experiences).where(eq(experiences.id, id)).limit(1);
  return row;
}

export async function findExperienceWithDraft(
  db: ProductExecutor,
  id: string,
): Promise<{ experience: ExperienceRow; draft: ExperienceDraftRow | null } | undefined> {
  const [row] = await db
    .select({
      experience: experiences,
      draft: experienceDrafts,
    })
    .from(experiences)
    .leftJoin(experienceDrafts, eq(experiences.id, experienceDrafts.experience_id))
    .where(eq(experiences.id, id))
    .limit(1);

  if (!row) return undefined;
  return {
    experience: row.experience,
    draft: row.draft?.draft_id ? row.draft : null,
  };
}

export async function listExperiences(
  db: ProductExecutor,
  opts: { limit: number; cursor?: string },
): Promise<{
  items: Array<{
    experience: ExperienceRow;
    draftRef: { draft_id: string; revision: number; content_hash: string } | null;
  }>;
  next_cursor: string | null;
}> {
  let whereClause = undefined;
  if (opts.cursor) {
    const c = decodeExperienceCursor(opts.cursor);
    whereClause = sql`(${experiences.created_at} < ${c.created_at}::timestamptz OR (${experiences.created_at} = ${c.created_at}::timestamptz AND ${experiences.id} < ${c.id}))`;
  }

  const rows = await db
    .select({
      experience: experiences,
      draft: {
        draft_id: experienceDrafts.draft_id,
        revision: experienceDrafts.revision,
        content_hash: experienceDrafts.content_hash,
      },
      cursor_at: cursorTimestamp(experiences.created_at),
    })
    .from(experiences)
    .leftJoin(experienceDrafts, eq(experiences.id, experienceDrafts.experience_id))
    .where(whereClause)
    .orderBy(desc(experiences.created_at), desc(experiences.id))
    .limit(opts.limit + 1);

  let nextCursor: string | null = null;
  if (rows.length > opts.limit) {
    rows.pop();
    const last = rows[rows.length - 1];
    if (last) {
      nextCursor = encodeExperienceCursor({ created_at: last.cursor_at, id: last.experience.id });
    }
  }

  const items = rows.map((r) => ({
    experience: r.experience,
    draftRef: r.draft?.draft_id ? r.draft : null,
  }));

  return { items, next_cursor: nextCursor };
}

export async function insertExperienceWithDraft(
  db: ProductExecutor,
  input: {
    id: string;
    name: string;
    description?: string;
    activity_type?: string;
    updated_by?: string;
    initialDraftContent?: Record<string, unknown>;
  },
): Promise<{ experience: ExperienceRow; draft: ExperienceDraftRow }> {
  return db.transaction(async (tx) => {
    const [exp] = await tx
      .insert(experiences)
      .values({
        id: input.id,
        name: input.name,
        description: input.description ?? '',
        activity_type: input.activity_type ?? 'personality_assessment',
        revision: 0,
      })
      .returning();

    if (!exp) throw new Error('insert experience returned no row');

    const draftContent = input.initialDraftContent ?? {};
    const draftHash = computeContentHash(draftContent);
    const draftId = `draft_${input.id}`;

    const [draft] = await tx
      .insert(experienceDrafts)
      .values({
        draft_id: draftId,
        experience_id: input.id,
        revision: 0,
        content_hash: draftHash,
        content: draftContent,
        updated_by: input.updated_by ?? 'admin',
      })
      .returning();

    if (!draft) throw new Error('insert draft returned no row');

    return { experience: exp, draft };
  });
}

export type PatchExperienceResult =
  | {
      status: 'ok';
      experience: ExperienceRow;
      draftRef: { draft_id: string; revision: number; content_hash: string } | null;
    }
  | { status: 'not_found' }
  | { status: 'conflict'; current: ExperienceRow };

export async function patchExperienceMetadata(
  db: ProductExecutor,
  id: string,
  expectedRevision: number,
  patch: { name?: string; description?: string },
): Promise<PatchExperienceResult> {
  const values: Record<string, unknown> = {
    revision: sql`${experiences.revision} + CASE WHEN ${experiences.name} IS DISTINCT FROM COALESCE(${patch.name ?? null}, ${experiences.name}) OR ${experiences.description} IS DISTINCT FROM COALESCE(${patch.description ?? null}, ${experiences.description}) THEN 1 ELSE 0 END`,
    updated_at: sql`CASE WHEN ${experiences.name} IS DISTINCT FROM COALESCE(${patch.name ?? null}, ${experiences.name}) OR ${experiences.description} IS DISTINCT FROM COALESCE(${patch.description ?? null}, ${experiences.description}) THEN now() ELSE ${experiences.updated_at} END`,
  };
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.description !== undefined) values.description = patch.description;

  const [updated] = await db
    .update(experiences)
    .set(values)
    .where(and(eq(experiences.id, id), eq(experiences.revision, expectedRevision)))
    .returning();

  if (updated) {
    const [draft] = await db
      .select({
        draft_id: experienceDrafts.draft_id,
        revision: experienceDrafts.revision,
        content_hash: experienceDrafts.content_hash,
      })
      .from(experienceDrafts)
      .where(eq(experienceDrafts.experience_id, id))
      .limit(1);

    return {
      status: 'ok',
      experience: updated,
      draftRef: draft ?? null,
    };
  }

  const existing = await findExperienceById(db, id);
  if (!existing) {
    return { status: 'not_found' };
  }
  return { status: 'conflict', current: existing };
}

export async function findDraftByExperienceId(
  db: ProductExecutor,
  experienceId: string,
): Promise<ExperienceDraftRow | undefined> {
  const [row] = await db
    .select()
    .from(experienceDrafts)
    .where(eq(experienceDrafts.experience_id, experienceId))
    .limit(1);
  return row;
}

export type UpdateDraftResult =
  | { status: 'ok'; draft: ExperienceDraftRow }
  | { status: 'not_found' }
  | { status: 'conflict'; current: ExperienceDraftRow };

export async function updateDraftContent(
  db: ProductExecutor,
  experienceId: string,
  expectedRevision: number,
  newContent: Record<string, unknown>,
  newHash: string,
  updatedBy: string,
): Promise<UpdateDraftResult> {
  const [updated] = await db
    .update(experienceDrafts)
    .set({
      revision: sql`${experienceDrafts.revision} + CASE WHEN ${experienceDrafts.content_hash} IS DISTINCT FROM ${newHash} THEN 1 ELSE 0 END`,
      content: newContent,
      content_hash: newHash,
      updated_by: sql`CASE WHEN ${experienceDrafts.content_hash} IS DISTINCT FROM ${newHash} THEN ${updatedBy} ELSE ${experienceDrafts.updated_by} END`,
      updated_at: sql`CASE WHEN ${experienceDrafts.content_hash} IS DISTINCT FROM ${newHash} THEN now() ELSE ${experienceDrafts.updated_at} END`,
    })
    .where(
      and(
        eq(experienceDrafts.experience_id, experienceId),
        eq(experienceDrafts.revision, expectedRevision),
      ),
    )
    .returning();

  if (updated) {
    return { status: 'ok', draft: updated };
  }

  const existing = await findDraftByExperienceId(db, experienceId);
  if (!existing) {
    return { status: 'not_found' };
  }
  return { status: 'conflict', current: existing };
}

export type InsertReleaseResult =
  | { status: 'ok'; release: ExperienceReleaseRow }
  | { status: 'duplicate_version' };

const RELEASE_VERSION_UNIQUE = 'experience_releases_exp_id_def_ver_unique';

/** Drizzle wraps the pg error in `cause`; only the definition-version constraint means a duplicate release. */
function isDuplicateVersionViolation(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; depth < 5 && e && typeof e === 'object'; depth += 1) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    if (code === '23505') return constraint === RELEASE_VERSION_UNIQUE;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

export async function insertExperienceRelease(
  db: ProductExecutor,
  input: {
    id: string;
    experience_id: string;
    definition_version: string;
    definition_hash: string;
    definition_schema_version: string;
    engine_version: string;
    is_demo: boolean;
    approval_refs: string[];
    validation_id: string;
    evaluation_id: string;
    content: Record<string, unknown>;
    published_by: string;
  },
): Promise<InsertReleaseResult> {
  try {
    const [row] = await db.insert(experienceReleases).values(input).returning();
    if (!row) throw new Error('insert release returned no row');
    return { status: 'ok', release: row };
  } catch (err: unknown) {
    if (isDuplicateVersionViolation(err)) {
      return { status: 'duplicate_version' };
    }
    throw err;
  }
}

export async function findReleaseById(
  db: ProductExecutor,
  releaseId: string,
): Promise<ExperienceReleaseRow | undefined> {
  const [row] = await db
    .select()
    .from(experienceReleases)
    .where(eq(experienceReleases.id, releaseId))
    .limit(1);
  return row;
}

export async function listExperienceReleases(
  db: ProductExecutor,
  experienceId: string,
  opts: { limit: number; cursor?: string },
): Promise<{ items: ExperienceReleaseRow[]; next_cursor: string | null }> {
  let whereClause = eq(experienceReleases.experience_id, experienceId);
  if (opts.cursor) {
    const c = decodeReleaseCursor(opts.cursor, experienceId);
    whereClause = and(
      eq(experienceReleases.experience_id, experienceId),
      sql`(${experienceReleases.published_at} < ${c.published_at}::timestamptz OR (${experienceReleases.published_at} = ${c.published_at}::timestamptz AND ${experienceReleases.id} < ${c.id}))`,
    )!;
  }

  const rows = await db
    .select({ release: experienceReleases, cursor_at: cursorTimestamp(experienceReleases.published_at) })
    .from(experienceReleases)
    .where(whereClause)
    .orderBy(desc(experienceReleases.published_at), desc(experienceReleases.id))
    .limit(opts.limit + 1);

  let nextCursor: string | null = null;
  if (rows.length > opts.limit) {
    rows.pop();
    const last = rows[rows.length - 1];
    if (last) {
      nextCursor = encodeReleaseCursor({ published_at: last.cursor_at, id: last.release.id }, experienceId);
    }
  }

  return { items: rows.map((row) => row.release), next_cursor: nextCursor };
}

export async function findIdempotencyRecord(
  db: ProductExecutor,
  scope: string,
  key: string,
): Promise<IdempotencyRecordRow | undefined> {
  const [row] = await db
    .select()
    .from(idempotencyRecords)
    .where(and(eq(idempotencyRecords.scope, scope), eq(idempotencyRecords.key, key)))
    .limit(1);
  return row;
}

export async function saveIdempotencyRecord(
  db: ProductExecutor,
  record: {
    scope: string;
    key: string;
    request_hash: string;
    response_status: number;
    response_body: Record<string, unknown>;
  },
): Promise<void> {
  // No ON CONFLICT: callers hold the key's advisory lock, so a conflict here is a real fault, not a race.
  await db.insert(idempotencyRecords).values(record);
}

/**
 * Run `work` in one transaction that first takes a transaction-scoped advisory lock on (scope, key).
 * Requests reusing a key serialize here; under READ COMMITTED the next one then sees the committed
 * record and replays it. The record and the business write therefore commit or roll back together.
 */
export async function withIdempotencyLock<T>(
  db: ProductDatabase,
  scope: string,
  key: string,
  work: (tx: ProductExecutor) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope}|${key}`}, 0))`);
    return work(tx);
  });
}
