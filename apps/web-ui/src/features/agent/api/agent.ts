import { api } from '@/lib/api/client';
import type { AgentActive, AgentConfig, AgentDraft, AgentRelease, AgentReleaseSummary, AgentValidation, AuditEvent, Page } from '../types';

const BASE = 'admin/agent';
const cursorQuery = (cursor?: string | null) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');

async function page<T>(path: string): Promise<Page<T>> {
  const { data, meta } = await api.getWithMeta<{ items: T[] }, { pagination?: { next_cursor: string | null } }>(path);
  return { items: data.items, next_cursor: meta?.pagination?.next_cursor ?? null };
}

export const agentApi = {
  getDraft: () => api.get<AgentDraft>(`${BASE}/draft`),
  saveDraft: (body: { content: AgentConfig; expected_revision: number }) => api.put<AgentDraft>(`${BASE}/draft`, body),
  validate: () => api.post<AgentValidation>(`${BASE}/draft/validations`),
  getActive: () => api.get<AgentActive | null>(`${BASE}/active`),
  listReleases: (cursor?: string | null) => page<AgentReleaseSummary>(`${BASE}/releases${cursorQuery(cursor)}`),
  getRelease: (id: string) => api.get<AgentRelease>(`${BASE}/releases/${encodeURIComponent(id)}`),
  publish: (body: { expected_draft_revision: number; expected_active_revision: number; note?: string; idempotency_key: string }) =>
    api.post<AgentRelease>(`${BASE}/releases`, body),
  restore: ({ id, ...body }: { id: string; expected_active_revision: number; idempotency_key: string }) =>
    api.post<AgentActive>(`${BASE}/releases/${encodeURIComponent(id)}:restore`, body),
  listAudit: (cursor?: string | null) => page<AuditEvent>(`${BASE}/audit-logs${cursorQuery(cursor)}`),
};
