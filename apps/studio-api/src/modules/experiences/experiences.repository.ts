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

export function encodeExperienceCursor(cursor: { created_at: Date | string; id: string }): string {
  const d = typeof cursor.created_at === 'string' ? cursor.created_at : cursor.created_at.toISOString();
  return Buffer.from(JSON.stringify({ created_at: d, id: cursor.id }), 'utf8').toString('base64url');
}

export function decodeExperienceCursor(cursorStr: string): ExperienceCursor {
  try {
    const raw = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.created_at !== 'string' || typeof parsed.id !== 'string') {
      throw new Error('Malformed cursor');
    }
    return parsed as ExperienceCursor;
  } catch {
    throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Invalid pagination cursor');
  }
}

export function encodeReleaseCursor(cursor: { published_at: Date | string; id: string }): string {
  const d = typeof cursor.published_at === 'string' ? cursor.published_at : cursor.published_at.toISOString();
  return Buffer.from(JSON.stringify({ published_at: d, id: cursor.id }), 'utf8').toString('base64url');
}

export function decodeReleaseCursor(cursorStr: string): ReleaseCursor {
  try {
    const raw = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.published_at !== 'string' || typeof parsed.id !== 'string') {
      throw new Error('Malformed cursor');
    }
    return parsed as ReleaseCursor;
  } catch {
    throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Invalid pagination cursor');
  }
}

export async function findExperienceById(
  db: ProductDatabase,
  id: string,
): Promise<ExperienceRow | undefined> {
  const [row] = await db.select().from(experiences).where(eq(experiences.id, id)).limit(1);
  return row;
}

export async function findExperienceWithDraft(
  db: ProductDatabase,
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
  db: ProductDatabase,
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
      nextCursor = encodeExperienceCursor({
        created_at: last.experience.created_at,
        id: last.experience.id,
      });
    }
  }

  const items = rows.map((r) => ({
    experience: r.experience,
    draftRef: r.draft?.draft_id ? r.draft : null,
  }));

  return { items, next_cursor: nextCursor };
}

export async function insertExperienceWithDraft(
  db: ProductDatabase,
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
  db: ProductDatabase,
  id: string,
  expectedRevision: number,
  patch: { name?: string; description?: string },
): Promise<PatchExperienceResult> {
  const values: Record<string, unknown> = {
    revision: sql`${experiences.revision} + 1`,
    updated_at: sql`now()`,
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
  db: ProductDatabase,
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
  db: ProductDatabase,
  experienceId: string,
  expectedRevision: number,
  newContent: Record<string, unknown>,
  newHash: string,
  updatedBy: string,
): Promise<UpdateDraftResult> {
  const [updated] = await db
    .update(experienceDrafts)
    .set({
      revision: sql`${experienceDrafts.revision} + 1`,
      content: newContent,
      content_hash: newHash,
      updated_by: updatedBy,
      updated_at: sql`now()`,
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

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}

export async function insertExperienceRelease(
  db: ProductDatabase,
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
    if (isUniqueViolation(err)) {
      return { status: 'duplicate_version' };
    }
    throw err;
  }
}

export async function findReleaseById(
  db: ProductDatabase,
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
  db: ProductDatabase,
  experienceId: string,
  opts: { limit: number; cursor?: string },
): Promise<{ items: ExperienceReleaseRow[]; next_cursor: string | null }> {
  let whereClause = eq(experienceReleases.experience_id, experienceId);
  if (opts.cursor) {
    const c = decodeReleaseCursor(opts.cursor);
    whereClause = and(
      eq(experienceReleases.experience_id, experienceId),
      sql`(${experienceReleases.published_at} < ${c.published_at}::timestamptz OR (${experienceReleases.published_at} = ${c.published_at}::timestamptz AND ${experienceReleases.id} < ${c.id}))`,
    )!;
  }

  const rows = await db
    .select()
    .from(experienceReleases)
    .where(whereClause)
    .orderBy(desc(experienceReleases.published_at), desc(experienceReleases.id))
    .limit(opts.limit + 1);

  let nextCursor: string | null = null;
  if (rows.length > opts.limit) {
    rows.pop();
    const last = rows[rows.length - 1];
    if (last) {
      nextCursor = encodeReleaseCursor({
        published_at: last.published_at,
        id: last.id,
      });
    }
  }

  return { items: rows, next_cursor: nextCursor };
}

export async function findIdempotencyRecord(
  db: ProductDatabase,
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
  db: ProductDatabase,
  record: {
    scope: string;
    key: string;
    request_hash: string;
    response_status: number;
    response_body: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(idempotencyRecords).values(record).onConflictDoNothing();
}
