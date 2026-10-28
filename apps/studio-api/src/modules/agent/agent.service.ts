import type { ProductDatabase } from '@/infrastructure/db/client';
import { ProductError } from '@/http/errors';
import type { RequestContext } from '@/http/types';
import { computeContentHash } from '@/modules/experiences/canonical';
import * as repo from '@/modules/agent/agent.repository';
import { getAgentValidator, type AgentValidation } from '@/modules/agent/runtime-validation';
import { toDraftDTO, type AgentDraftDTO, type SaveDraftInput } from '@/modules/agent/agent.schemas';

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
  const result = await repo.saveDraft(db, { expectedRevision: input.expected_revision, content: input.content, hash, actor });
  if (result.status === 'conflict') {
    throw new ProductError(409, 'CONFLICT_REVISION', 'Agent draft revision conflict', false, {
      kind: 'revision_conflict', expected_revision: input.expected_revision, current: toDraftDTO(result.current),
    });
  }
  if (result.draft.revision !== input.expected_revision) {
    await repo.insertAudit(db, { actor, action: 'agent.draft.save', target_kind: 'agent', target_id: 'default',
      before_ref: `draft@${input.expected_revision}`, after_ref: `draft@${result.draft.revision}`, outcome: 'success', details: {} });
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
