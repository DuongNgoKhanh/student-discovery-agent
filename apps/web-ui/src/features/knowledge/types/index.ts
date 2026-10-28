import type { components } from '@/generated/api/knowledge-api';

type Schemas = components['schemas'];
export type KnowledgeBase = Schemas['KnowledgeBase'];
export type KnowledgeBaseCreate = Schemas['KnowledgeBaseCreate'];
export type KnowledgeBasePatch = Schemas['KnowledgeBasePatch'];
export type MetadataField = Schemas['MetadataField'];
export type FieldType = Schemas['FieldType'];
export type FieldCreate = Schemas['FieldCreate'];
export type FieldPatch = Schemas['FieldPatch'];
export type DocumentSummary = Schemas['DocumentSummary'];
export type IndexStatus = Schemas['IndexStatus'];
export type PaginationMeta = Schemas['PaginationMeta'];
/** Query params of GET .../documents; `cursor` comes from a previous page's `next_cursor`. */
export interface DocumentFilters {
  q?: string;
  status?: DocumentSummary['status'];
  index_status?: IndexStatus;
  cursor?: string;
  limit?: number;
}
export interface DocumentPage { items: DocumentSummary[]; next_cursor: string | null }
export type DocumentDetail = Schemas['DocumentDetail'];
export type DocumentPut = Schemas['DocumentPut'];
export type DocumentWriteResult = Schemas['DocumentWriteResult'];
export type ImportPreviewRequest = Schemas['ImportPreviewRequest'];
export type ImportPreview = Schemas['ImportPreview'];
export type ImportPreviewRow = Schemas['ImportPreviewRow'];
export type ImportCommitRequest = Schemas['ImportCommitRequest'];
export type ImportReport = Schemas['ImportReport'];
export type SearchRequest = Schemas['SearchRequest'];
export type SearchResult = Schemas['SearchResult'];
export type AgentParams = Schemas['AgentParams'];
