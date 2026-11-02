import { z } from 'zod';
import type { AgentActiveRow, AgentDraftRow, AgentReleaseRow, AuditEventRow } from '@/modules/agent/agent.repository';

const jsonObject = z.record(z.unknown()).refine(v => !Array.isArray(v), 'content must be a JSON object');
const idempotencyKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
const revision = z.number().int().min(1);

export const saveDraftSchema = z.object({ content: jsonObject, expected_revision: revision }).strict();
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

export const publishSchema = z.object({
  expected_draft_revision: revision,
  expected_active_revision: revision,
  note: z.string().trim().max(500).optional(),
  idempotency_key: idempotencyKey,
}).strict();
export type PublishInput = z.infer<typeof publishSchema>;

export const restoreSchema = z.object({ expected_active_revision: revision, idempotency_key: idempotencyKey }).strict();
export type RestoreInput = z.infer<typeof restoreSchema>;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(4096).optional(),
}).strict();

export const releaseIdSchema = z.string().regex(/^agr_[0-9a-f]{24}$/);

const iso = (d: Date) => d.toISOString();

export const toDraftDTO = (row: AgentDraftRow) => ({
  content: row.content, revision: row.revision, content_hash: row.content_hash,
  updated_at: iso(row.updated_at), updated_by: row.updated_by,
});
export type AgentDraftDTO = ReturnType<typeof toDraftDTO>;

export const toReleaseSummaryDTO = (row: AgentReleaseRow, activeId: string | null) => ({
  id: row.id, version: row.version, content_hash: row.content_hash, draft_revision: row.draft_revision,
  note: row.note, created_at: iso(row.created_at), created_by: row.created_by, is_active: row.id === activeId,
});
export const toReleaseDTO = (row: AgentReleaseRow, activeId: string | null) => ({
  ...toReleaseSummaryDTO(row, activeId), content: row.content,
});

export const toActiveDTO = (active: AgentActiveRow, release: AgentReleaseRow) => ({
  release_id: release.id, version: release.version, content_hash: release.content_hash,
  revision: active.revision, updated_at: iso(active.updated_at), updated_by: active.updated_by,
});
export type AgentActiveDTO = ReturnType<typeof toActiveDTO>;

export const toAuditDTO = (row: AuditEventRow) => ({
  id: row.id, at: iso(row.at), actor: row.actor, action: row.action, before_ref: row.before_ref,
  after_ref: row.after_ref, outcome: row.outcome, details: row.details,
});
