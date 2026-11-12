import type { components } from '@/generated/api/agent-api';

type Schemas = components['schemas'];

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

export interface ChatflowNode {
  id: string;
  type: Schemas['ChatflowNodeType'];
  title?: string;
  config?: Record<string, unknown>;
  ui?: { position?: { x: number; y: number } };
}
export interface ChatflowEdge {
  id: string;
  source: string;
  source_handle: string;
  target: string;
}
export interface ChatflowWorkflow {
  entry: string;
  variables?: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'enum' | 'string_list';
    values?: string[];
    default: unknown;
  }>;
  nodes: ChatflowNode[];
  edges?: ChatflowEdge[];
  budget?: { max_nodes?: number; max_llm_calls?: number; turn_timeout_ms?: number };
}
export type ChatflowNodeType = Schemas['ChatflowNodeType'];
export type WorkflowNodeType = Schemas['WorkflowNodeType'];
export type WorkflowNodeTypeCatalog = Schemas['WorkflowNodeTypeCatalog'];
export type WorkflowNamespace = Schemas['WorkflowNamespace'];
export type WorkflowHandleSpec = Schemas['WorkflowHandleSpec'];
export type NodeTypeCatalog = WorkflowNodeTypeCatalog;
