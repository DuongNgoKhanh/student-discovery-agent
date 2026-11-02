import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { ProductError } from '@/http/errors';
import { agentActive, agentDraft, agentReleases, auditEvents } from '@/infrastructure/db/schema';
import { decodeCursor, encodeCursor } from '@/modules/experiences/cursor';
import {
  findIdempotencyRecord, saveIdempotencyRecord, withIdempotencyLock, type ProductExecutor,
} from '@/modules/experiences/experiences.repository';
import type { ProductDatabase } from '@/infrastructure/db/client';

export type AgentDraftRow = typeof agentDraft.$inferSelect;
export type AgentReleaseRow = typeof agentReleases.$inferSelect;
export type AgentActiveRow = typeof agentActive.$inferSelect;
export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEvent = Omit<typeof auditEvents.$inferInsert, 'id' | 'at'>;

const DRAFT_ID = 'default';
// Microsecond UTC text so keyset pagination never skips rows sharing a millisecond.
const micros = (column: typeof agentReleases.created_at | typeof auditEvents.at) =>
  sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const CURSOR_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function readCursor(token: string, scope: string): { at: string; id: string } {
  const value = decodeCursor(token, scope) as { at?: unknown; id?: unknown } | null;
  if (!value || typeof value.at !== 'string' || !CURSOR_AT.test(value.at) || typeof value.id !== 'string') {
    throw new ProductError(400, 'VAL_INVALID_REQUEST', 'Invalid pagination cursor');
  }
  return { at: value.at, id: value.id };
}

export async function getDraft(db: ProductExecutor): Promise<AgentDraftRow | undefined> {
  const [row] = await db.select().from(agentDraft).where(eq(agentDraft.id, DRAFT_ID)).limit(1);
  return row;
}

export async function insertDraftIfMissing(
  db: ProductExecutor, input: { content: Record<string, unknown>; hash: string; actor: string },
): Promise<void> {
  await db.insert(agentDraft)
    .values({ id: DRAFT_ID, content: input.content, content_hash: input.hash, updated_by: input.actor })
    .onConflictDoNothing();
}

/** Same hash keeps revision/updated_* (no-op save); a stale `expectedRevision` returns the server copy. */
export async function saveDraft(
  db: ProductExecutor,
  input: { expectedRevision: number; content: Record<string, unknown>; hash: string; actor: string },
): Promise<{ status: 'ok'; draft: AgentDraftRow } | { status: 'conflict'; current: AgentDraftRow }> {
  const changed = sql`${agentDraft.content_hash} IS DISTINCT FROM ${input.hash}`;
  const [updated] = await db.update(agentDraft).set({
    revision: sql`${agentDraft.revision} + CASE WHEN ${changed} THEN 1 ELSE 0 END`,
    content: input.content,
    content_hash: input.hash,
    updated_by: sql`CASE WHEN ${changed} THEN ${input.actor} ELSE ${agentDraft.updated_by} END`,
    updated_at: sql`CASE WHEN ${changed} THEN now() ELSE ${agentDraft.updated_at} END`,
  }).where(and(eq(agentDraft.id, DRAFT_ID), eq(agentDraft.revision, input.expectedRevision))).returning();
  if (updated) return { status: 'ok', draft: updated };
  const current = await getDraft(db);
  if (!current) throw new ProductError(404, 'RES_NOT_FOUND', 'Agent draft not found');
  return { status: 'conflict', current };
}

export async function getActive(db: ProductExecutor) {
  const [row] = await db.select({ active: agentActive, release: agentReleases })
    .from(agentActive).innerJoin(agentReleases, eq(agentActive.release_id, agentReleases.id))
    .where(eq(agentActive.id, DRAFT_ID)).limit(1);
  return row;
}

export async function lockActive(tx: ProductExecutor): Promise<AgentActiveRow | undefined> {
  const [row] = await tx.select().from(agentActive).where(eq(agentActive.id, DRAFT_ID)).for('update').limit(1);
  return row;
}

export async function insertRelease(
  tx: ProductExecutor,
  input: { content: Record<string, unknown>; hash: string; draftRevision: number; note: string | null; actor: string },
): Promise<AgentReleaseRow> {
  // Callers hold the agent_active row lock (or seed alone), so max+1 cannot race.
  const [row] = await tx.insert(agentReleases).values({
    id: `agr_${randomBytes(12).toString('hex')}`,
    version: sql`(SELECT COALESCE(MAX(version), 0) + 1 FROM product.agent_releases)`,
    content: input.content,
    content_hash: input.hash,
    draft_revision: input.draftRevision,
    note: input.note,
    created_by: input.actor,
  }).returning();
  return row!;
}

/** `expectedRevision: null` creates the pointer (seed); otherwise returns null when the revision moved. */
export async function pointActive(
  tx: ProductExecutor, input: { releaseId: string; expectedRevision: number | null; actor: string },
): Promise<AgentActiveRow | null> {
  if (input.expectedRevision === null) {
    const [row] = await tx.insert(agentActive)
      .values({ id: DRAFT_ID, release_id: input.releaseId, updated_by: input.actor })
      .onConflictDoNothing().returning();
    return row ?? null;
  }
  const [row] = await tx.update(agentActive).set({
    release_id: input.releaseId, revision: sql`${agentActive.revision} + 1`, updated_by: input.actor, updated_at: sql`now()`,
  }).where(and(eq(agentActive.id, DRAFT_ID), eq(agentActive.revision, input.expectedRevision))).returning();
  return row ?? null;
}

export async function findRelease(db: ProductExecutor, id: string): Promise<AgentReleaseRow | undefined> {
  const [row] = await db.select().from(agentReleases).where(eq(agentReleases.id, id)).limit(1);
  return row;
}

export async function countReleases(db: ProductExecutor): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(agentReleases);
  return row?.n ?? 0;
}

export async function listReleases(db: ProductExecutor, opts: { limit: number; cursor?: string }) {
  const scope = 'agent-releases:created_at:desc';
  const after = opts.cursor ? readCursor(opts.cursor, scope) : null;
  const rows = await db.select({ release: agentReleases, cursor_at: micros(agentReleases.created_at) })
    .from(agentReleases)
    .where(after ? sql`(${agentReleases.created_at}, ${agentReleases.id}) < (${after.at}::timestamptz, ${after.id})` : undefined)
    .orderBy(desc(agentReleases.created_at), desc(agentReleases.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit);
  const last = page.at(-1);
  return {
    items: page.map(r => r.release),
    next_cursor: rows.length > opts.limit && last ? encodeCursor(scope, { at: last.cursor_at, id: last.release.id }) : null,
  };
}

export async function insertAudit(tx: ProductExecutor, event: NewAuditEvent): Promise<void> {
  await tx.insert(auditEvents).values({ id: randomUUID(), at: sql`clock_timestamp()`, ...event });
}

export async function listAudit(db: ProductExecutor, opts: { limit: number; cursor?: string }) {
  const scope = 'audit:agent:at:desc';
  const after = opts.cursor ? readCursor(opts.cursor, scope) : null;
  const rows = await db.select({ event: auditEvents, cursor_at: micros(auditEvents.at) })
    .from(auditEvents)
    .where(and(eq(auditEvents.target_kind, 'agent'),
      after ? sql`(${auditEvents.at}, ${auditEvents.id}) < (${after.at}::timestamptz, ${after.id})` : undefined))
    .orderBy(desc(auditEvents.at), desc(auditEvents.id))
    .limit(opts.limit + 1);
  const page = rows.slice(0, opts.limit);
  const last = page.at(-1);
  return {
    items: page.map(r => r.event),
    next_cursor: rows.length > opts.limit && last ? encodeCursor(scope, { at: last.cursor_at, id: last.event.id }) : null,
  };
}

export type ProductExecutorLike = ProductExecutor;

// Wrappers let unit tests mock this module alone, without mocking the experiences repository.
export const withAgentLock = <T>(db: ProductDatabase, scope: string, key: string, work: (tx: ProductExecutor) => Promise<T>) =>
  withIdempotencyLock(db, scope, key, work);
export const findIdempotencyRecordForAgent = findIdempotencyRecord;
export const saveIdempotencyRecordForAgent = saveIdempotencyRecord;
