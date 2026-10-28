import type { ProductDatabase } from '@/infrastructure/db/client';
import { ProductError } from '@/http/errors';
import type { RequestContext } from '@/http/types';
import { computeContentHash } from '@/modules/experiences/canonical';
import * as repo from '@/modules/agent/agent.repository';
import { getAgentValidator, type AgentValidation } from '@/modules/agent/runtime-validation';
import {
  toActiveDTO, toAuditDTO, toDraftDTO, toReleaseDTO, toReleaseSummaryDTO,
  type AgentActiveDTO, type AgentDraftDTO, type PublishInput, type RestoreInput, type SaveDraftInput,
} from '@/modules/agent/agent.schemas';

export async function readDraft(db: ProductDatabase): Promise<AgentDraftDTO> {
  const row = await repo.getDraft(db);
  if (!row) throw new ProductError(404, 'RES_NOT_FOUND', 'Agent draft not found');
  return toDraftDTO(row);
}

export async function saveDraftContent(db: ProductDatabase, input: SaveDraftInput, actor: string): Promise<AgentDraftDTO> {
  let hash: string;
  try {
    hash = computeContentHash(input.content);
  } catch {
    throw new ProductError(422, 'VAL_INVALID_INPUT', 'Content is not canonical JSON', false, { kind: 'validation', issues: [] });
  }
  // Save and its audit row commit together.
  const result = await db.transaction(async tx => {
    const saved = await repo.saveDraft(tx, { expectedRevision: input.expected_revision, content: input.content, hash, actor });
    if (saved.status === 'ok' && saved.draft.revision !== input.expected_revision) {
      await repo.insertAudit(tx, { actor, action: 'agent.draft.save', target_kind: 'agent', target_id: 'default',
        before_ref: `draft@${input.expected_revision}`, after_ref: `draft@${saved.draft.revision}`, outcome: 'success', details: {} });
    }
    return saved;
  });
  if (result.status === 'conflict') {
    throw new ProductError(409, 'CONFLICT_REVISION', 'Agent draft revision conflict', false, {
      kind: 'revision_conflict', expected_revision: input.expected_revision, current: toDraftDTO(result.current),
    });
  }
  return toDraftDTO(result.draft);
}

/** Local/bootstrap only: draft + v1 + pointer from agent.json when no release exists yet. */
export async function seedAgent(db: ProductDatabase, content: Record<string, unknown>): Promise<'seeded' | 'skipped'> {
  return db.transaction(async tx => {
    if ((await repo.countReleases(tx)) > 0) return 'skipped';
    const hash = computeContentHash(content);
    await repo.insertDraftIfMissing(tx, { content, hash, actor: 'system:seed' });
    const release = await repo.insertRelease(tx, { content, hash, draftRevision: 1, note: 'Seed từ agent.json', actor: 'system:seed' });
    await repo.pointActive(tx, { releaseId: release.id, expectedRevision: null, actor: 'system:seed' });
    await repo.insertAudit(tx, { actor: 'system:seed', action: 'agent.release.publish', target_kind: 'agent', target_id: 'default',
      before_ref: null, after_ref: release.id, outcome: 'success', details: { version: release.version } });
    return 'seeded';
  });
}

export async function validateDraft(db: ProductDatabase, ctx: RequestContext): Promise<AgentValidation & { draft_revision: number }> {
  const draft = await repo.getDraft(db);
  if (!draft) throw new ProductError(404, 'RES_NOT_FOUND', 'Agent draft not found');
  return { ...(await getAgentValidator()(draft.content, ctx)), draft_revision: draft.revision };
}

export interface ServiceResult<T> { status: number; data: T; replayed?: boolean }
export type AgentReleaseDTO = ReturnType<typeof toReleaseDTO>;

function replayOf<T>(existing: { request_hash: string; response_status: number; response_body: unknown } | undefined, requestHash: string): ServiceResult<T> | undefined {
  if (!existing) return undefined;
  if (existing.request_hash !== requestHash) {
    throw new ProductError(409, 'CONFLICT_IDEMPOTENCY_KEY', 'Idempotency key reused with different request payload');
  }
  return { status: existing.response_status, data: existing.response_body as T, replayed: true };
}

/** Unlocked early lookup so a retry replays the stored result regardless of current state. */
async function earlyReplay<T>(db: ProductDatabase, scope: string, key: string, payload: unknown): Promise<ServiceResult<T> | undefined> {
  return replayOf<T>(await repo.findIdempotencyRecordForAgent(db, scope, key), computeContentHash(payload));
}

async function idempotent<T>(
  db: ProductDatabase, scope: string, key: string, payload: unknown, status: number,
  work: (tx: repo.ProductExecutorLike) => Promise<T>,
): Promise<ServiceResult<T>> {
  const requestHash = computeContentHash(payload);
  return repo.withAgentLock(db, scope, key, async tx => {
    const replay = replayOf<T>(await repo.findIdempotencyRecordForAgent(tx, scope, key), requestHash);
    if (replay) return replay;
    const data = await work(tx);
    await repo.saveIdempotencyRecordForAgent(tx, {
      scope, key, request_hash: requestHash, response_status: status, response_body: data as unknown as Record<string, unknown>,
    });
    return { status, data };
  });
}

function gateFailed(issues: unknown[]): ProductError {
  return new ProductError(422, 'PUBLISH_GATE_FAILED', 'Agent config failed validation', false, { kind: 'validation', issues });
}

async function lockedPointer(tx: repo.ProductExecutorLike, expected: number) {
  const pointer = await repo.lockActive(tx);
  if (!pointer) throw new ProductError(422, 'RES_EXPERIENCE_NOT_CONFIGURED', 'No active agent release');
  if (pointer.revision !== expected) {
    throw new ProductError(409, 'CONFLICT_REVISION', 'Active agent changed', false,
      { kind: 'revision_conflict', expected_active_revision: expected, actual_active_revision: pointer.revision });
  }
  return pointer;
}

export async function publish(
  db: ProductDatabase, input: PublishInput, actor: string, ctx: RequestContext,
): Promise<ServiceResult<AgentReleaseDTO>> {
  const replay = await earlyReplay<AgentReleaseDTO>(db, 'agent:publish', input.idempotency_key, input);
  if (replay) return replay;
  const draft = await repo.getDraft(db);
  if (!draft) throw new ProductError(404, 'RES_NOT_FOUND', 'Agent draft not found');
  if (draft.revision !== input.expected_draft_revision) {
    throw new ProductError(409, 'CONFLICT_REVISION', 'Agent draft changed', false,
      { kind: 'revision_conflict', expected_draft_revision: input.expected_draft_revision, actual_draft_revision: draft.revision });
  }
  // Validate outside the transaction (network call); the hash check inside binds the report to this content.
  const report = await getAgentValidator()(draft.content, ctx);
  if (!report.valid) throw gateFailed(report.issues);
  // The report must describe exactly this draft; anything else means a broken validator, never a publish.
  if (report.content_hash !== draft.content_hash) {
    throw new ProductError(503, 'SYS_UNAVAILABLE', 'Validation report does not match the draft', true, { kind: 'hash_mismatch' });
  }
  return idempotent(db, 'agent:publish', input.idempotency_key, input, 201, async tx => {
    const pointer = await lockedPointer(tx, input.expected_active_revision);
    const current = await repo.getDraft(tx);
    if (!current || current.revision !== input.expected_draft_revision || current.content_hash !== draft.content_hash) {
      throw new ProductError(409, 'CONFLICT_REVISION', 'Agent draft changed during publish', false, { kind: 'revision_conflict' });
    }
    const before = await repo.findRelease(tx, pointer.release_id);
    if (before?.content_hash === current.content_hash) {
      throw new ProductError(409, 'CONFLICT_INVALID_STATE', 'Draft equals the active release', false, { kind: 'no_changes' });
    }
    const created = await repo.insertRelease(tx, {
      content: current.content, hash: current.content_hash, draftRevision: current.revision, note: input.note || null, actor,
    });
    if (!(await repo.pointActive(tx, { releaseId: created.id, expectedRevision: pointer.revision, actor }))) {
      throw new ProductError(409, 'CONFLICT_REVISION', 'Active agent changed', false, { kind: 'revision_conflict' });
    }
    await repo.insertAudit(tx, {
      actor, action: 'agent.release.publish', target_kind: 'agent', target_id: 'default',
      before_ref: pointer.release_id, after_ref: created.id, outcome: 'success', details: { version: created.version },
    });
    return toReleaseDTO(created, created.id);
  });
}

export async function restore(
  db: ProductDatabase, releaseId: string, input: RestoreInput, actor: string, ctx: RequestContext,
): Promise<ServiceResult<AgentActiveDTO>> {
  const payload = { ...input, release_id: releaseId };
  const replay = await earlyReplay<AgentActiveDTO>(db, 'agent:restore', input.idempotency_key, payload);
  if (replay) return replay;
  const target = await repo.findRelease(db, releaseId);
  if (!target) throw new ProductError(404, 'RES_NOT_FOUND', 'Agent release not found');
  const report = await getAgentValidator()(target.content, ctx);
  if (!report.valid) throw gateFailed(report.issues);
  return idempotent(db, 'agent:restore', input.idempotency_key, payload, 200, async tx => {
    const pointer = await lockedPointer(tx, input.expected_active_revision);
    if (pointer.release_id === releaseId) {
      throw new ProductError(409, 'CONFLICT_INVALID_STATE', 'Release is already active', false, { kind: 'no_changes' });
    }
    const moved = await repo.pointActive(tx, { releaseId, expectedRevision: pointer.revision, actor });
    if (!moved) throw new ProductError(409, 'CONFLICT_REVISION', 'Active agent changed', false, { kind: 'revision_conflict' });
    await repo.insertAudit(tx, {
      actor, action: 'agent.release.restore', target_kind: 'agent', target_id: 'default',
      before_ref: pointer.release_id, after_ref: releaseId, outcome: 'success', details: { version: target.version },
    });
    return toActiveDTO(moved, target);
  });
}

export async function getActiveAgent(db: ProductDatabase): Promise<AgentActiveDTO | null> {
  const row = await repo.getActive(db);
  return row ? toActiveDTO(row.active, row.release) : null;
}

export async function listAgentReleases(db: ProductDatabase, query: { limit: number; cursor?: string }) {
  const [page, row] = await Promise.all([repo.listReleases(db, query), repo.getActive(db)]);
  const activeId = row?.release.id ?? null;
  return { items: page.items.map(r => toReleaseSummaryDTO(r, activeId)), next_cursor: page.next_cursor };
}

export async function getAgentRelease(db: ProductDatabase, id: string) {
  const [release, row] = await Promise.all([repo.findRelease(db, id), repo.getActive(db)]);
  if (!release) throw new ProductError(404, 'RES_NOT_FOUND', 'Agent release not found');
  return toReleaseDTO(release, row?.release.id ?? null);
}

export async function listAgentAudit(db: ProductDatabase, query: { limit: number; cursor?: string }) {
  const page = await repo.listAudit(db, query);
  return { items: page.items.map(toAuditDTO), next_cursor: page.next_cursor };
}

export async function activeDescriptor(db: ProductDatabase, environment: string) {
  const row = await repo.getActive(db);
  if (!row) throw new ProductError(422, 'RES_EXPERIENCE_NOT_CONFIGURED', 'No active agent release');
  return { environment, kind: 'agent' as const, release_id: row.release.id, content_hash: row.release.content_hash,
    delivery_schema_version: 'agent.snapshot.v1' as const, content: row.release.content, is_demo: true as const };
}
