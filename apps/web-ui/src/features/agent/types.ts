export type AgentConfig = Record<string, unknown>;
export interface AgentDraft { content: AgentConfig; revision: number; content_hash: string; updated_at: string; updated_by: string }
export interface AgentIssue { path: string; code: string; message: string }
export interface AgentValidation { valid: boolean; content_hash: string; issues: AgentIssue[]; draft_revision: number }
export interface AgentReleaseSummary {
  id: string; version: number; content_hash: string; draft_revision: number; note: string | null;
  created_at: string; created_by: string; is_active: boolean;
}
export interface AgentRelease extends AgentReleaseSummary { content: AgentConfig }
export interface AgentActive { release_id: string; version: number; content_hash: string; revision: number; updated_at: string; updated_by: string }
export interface AuditEvent {
  id: string; at: string; actor: string; action: string; before_ref: string | null; after_ref: string | null;
  outcome: 'success' | 'rejected'; details: Record<string, unknown>;
}
export interface Page<T> { items: T[]; next_cursor: string | null }
