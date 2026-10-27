import { getKnowledgeEnv } from '@/config/env';
import { ProductError } from '@/http/errors';
import { inKnowledgeTransaction, withKnowledgeClient, type Queryable } from '@/infrastructure/db/knowledge-client';
import { decodeCursor, encodeCursor } from '@/modules/experiences/cursor';
import type {
  CreateFieldInput, CreateKnowledgeBaseInput, DocumentContent, ListDocumentsQuery, PatchFieldInput,
  PatchKnowledgeBaseInput, SearchInput,
} from '@/modules/knowledge/knowledge.schemas';
import {
  countDocumentsUsingField, deleteField as deleteFieldRow, findDocument, findKnowledgeBase, findRevisionId,
  insertField, insertKnowledgeBase, listDocumentRows, listFieldRows, listKnowledgeBaseRows, lockDocument, lockField,
  retryRevision, setDocumentStatus, updateField, updateKnowledgeBase,
  type DocumentRow, type DocumentSummaryRow, type FieldRow, type KnowledgeBaseRow,
} from '@/modules/knowledge/knowledge.repository';
import { newId } from '@/modules/knowledge/ids';
import { invalidMetadata, MetadataValidationError, namedMetadata } from '@/modules/knowledge/metadata';
import { slugify } from '@/modules/knowledge/slug';
import { retrieveKnowledge } from '@/modules/knowledge/runtime-client';
import { putDocument, type PutOutcome } from '@/modules/knowledge/writer';

export interface KnowledgeBaseDTO {
  id: string;
  name: string;
  description: string;
  embedding_model: string;
  document_count: number;
  error_count: number;
  created_at: string;
  updated_at: string;
}

export type FieldDTO = Omit<FieldRow, 'kb_id'>;

const toKnowledgeBaseDTO = (row: KnowledgeBaseRow): KnowledgeBaseDTO => ({
  id: row.id,
  name: row.name,
  description: row.description,
  embedding_model: row.embedding_model,
  document_count: row.document_count,
  error_count: row.error_count,
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
});

export const toFieldDTO = (row: FieldRow): FieldDTO => ({
  id: row.id,
  name: row.name,
  type: row.type,
  label: row.label,
  filterable: row.filterable,
  ordinal: row.ordinal,
});

const notFound = (what: string) => new ProductError(404, 'RES_NOT_FOUND', `${what} not found`);

export async function requireKnowledgeBase(client: Queryable, kbId: string): Promise<KnowledgeBaseRow> {
  const kb = await findKnowledgeBase(client, kbId);
  if (!kb) throw notFound('Knowledge base');
  return kb;
}

export async function listKnowledgeBases(): Promise<KnowledgeBaseDTO[]> {
  return withKnowledgeClient(async client => (await listKnowledgeBaseRows(client)).map(toKnowledgeBaseDTO));
}

export async function createKnowledgeBase(input: CreateKnowledgeBaseInput): Promise<KnowledgeBaseDTO> {
  if (!getKnowledgeEnv().KNOWLEDGE_EMBEDDING_MODELS.includes(input.embedding_model)) {
    throw new ProductError(422, 'VAL_INVALID_INPUT', 'Unsupported embedding model', false, {
      kind: 'validation',
      issues: [{ path: 'embedding_model', code: 'unsupported', message: 'Unsupported embedding model', rule_id: null }],
    });
  }
  const id = input.id ?? (slugify(input.name, 64) || newId('kb'));
  return inKnowledgeTransaction(async client => {
    if (!await insertKnowledgeBase(client, { id, name: input.name, description: input.description, embedding_model: input.embedding_model })) {
      throw new ProductError(409, 'CONFLICT_ALREADY_EXISTS', 'Knowledge base id already exists', false, { kind: 'already_exists', id });
    }
    return toKnowledgeBaseDTO((await findKnowledgeBase(client, id))!);
  });
}

export async function getKnowledgeBase(id: string): Promise<KnowledgeBaseDTO> {
  return withKnowledgeClient(async client => toKnowledgeBaseDTO(await requireKnowledgeBase(client, id)));
}

export async function patchKnowledgeBase(id: string, input: PatchKnowledgeBaseInput): Promise<KnowledgeBaseDTO> {
  return inKnowledgeTransaction(async client => {
    if (!await updateKnowledgeBase(client, id, input)) throw notFound('Knowledge base');
    return toKnowledgeBaseDTO((await findKnowledgeBase(client, id))!);
  });
}

export async function listFields(kbId: string): Promise<FieldDTO[]> {
  return withKnowledgeClient(async client => {
    await requireKnowledgeBase(client, kbId);
    return (await listFieldRows(client, kbId)).map(toFieldDTO);
  });
}

export async function createField(kbId: string, input: CreateFieldInput): Promise<FieldDTO> {
  return inKnowledgeTransaction(async client => {
    await requireKnowledgeBase(client, kbId);
    const row: FieldRow = { id: newId('fld'), kb_id: kbId, ...input };
    if (!await insertField(client, row)) {
      throw new ProductError(409, 'CONFLICT_ALREADY_EXISTS', 'Field already exists', false, { kind: 'already_exists', name: input.name });
    }
    return toFieldDTO(row);
  });
}

function immutable(path: 'name' | 'type'): ProductError {
  return new ProductError(422, 'VAL_INVALID_INPUT', `Field ${path} cannot change`, false, {
    kind: 'validation', issues: [{ path, code: 'immutable', message: `Field ${path} cannot change`, rule_id: null }],
  });
}

export async function patchField(kbId: string, name: string, input: PatchFieldInput): Promise<FieldDTO> {
  return inKnowledgeTransaction(async client => {
    await requireKnowledgeBase(client, kbId);
    const field = await lockField(client, kbId, name);
    if (!field) throw notFound('Field');
    if (input.name !== undefined && input.name !== field.name) throw immutable('name');
    if (input.type !== undefined && input.type !== field.type) throw immutable('type');
    return toFieldDTO(await updateField(client, field.id, input));
  });
}

export async function deleteField(kbId: string, name: string): Promise<{ name: string; deleted: true }> {
  return inKnowledgeTransaction(async client => {
    await requireKnowledgeBase(client, kbId);
    const field = await lockField(client, kbId, name);
    if (!field) throw notFound('Field');
    const documents = await countDocumentsUsingField(client, kbId, field.id);
    if (documents > 0) {
      throw new ProductError(409, 'CONFLICT_RESOURCE_IN_USE', 'Field is still used by active documents', false, {
        kind: 'field_in_use', documents,
      });
    }
    await deleteFieldRow(client, field.id);
    return { name, deleted: true };
  });
}

export interface DocumentDetailDTO {
  id: string;
  kb_id: string;
  status: 'active' | 'archived';
  revision: number;
  updated_at: string;
  latest: {
    revision: number; title: string; body: string; source_url: string | null; metadata: Record<string, unknown>;
    index_status: DocumentRow['index_status']; error: string | null; created_at: string;
  };
  active: { revision: number } | null;
}

export type DocumentSummaryDTO = Omit<DocumentSummaryRow, 'updated_at'> & { updated_at: string };

async function documentDetail(client: Queryable, kbId: string, documentId: string): Promise<DocumentDetailDTO> {
  const row = await findDocument(client, kbId, documentId);
  if (!row) throw notFound('Document');
  const fields = await listFieldRows(client, kbId);
  return {
    id: row.id,
    kb_id: row.kb_id,
    status: row.status,
    revision: row.revision,
    updated_at: row.updated_at.toISOString(),
    latest: {
      revision: row.latest_revision, title: row.title, body: row.body, source_url: row.source_url,
      metadata: namedMetadata(fields, row.metadata), index_status: row.index_status, error: row.error,
      created_at: row.latest_created_at.toISOString(),
    },
    active: row.active_revision === null ? null : { revision: row.active_revision },
  };
}

export async function getDocument(kbId: string, documentId: string): Promise<DocumentDetailDTO> {
  return withKnowledgeClient(async client => {
    await requireKnowledgeBase(client, kbId);
    return documentDetail(client, kbId, documentId);
  });
}

export async function listDocuments(kbId: string, query: ListDocumentsQuery) {
  const { cursor, limit, ...filter } = query;
  const scope = `knowledge-documents:${kbId}:${filter.status ?? ''}:${filter.index_status ?? ''}:${filter.q ?? ''}`;
  const afterId = cursor ? String(decodeCursor(cursor, scope)) : null;
  return withKnowledgeClient(async client => {
    await requireKnowledgeBase(client, kbId);
    const rows = await listDocumentRows(client, kbId, filter, afterId, limit + 1);
    const items: DocumentSummaryDTO[] = rows.slice(0, limit).map(row => ({ ...row, updated_at: row.updated_at.toISOString() }));
    const next_cursor = rows.length > limit ? encodeCursor(scope, items[items.length - 1]!.id) : null;
    return { items, next_cursor };
  });
}

/** Shared with import: maps a non-written outcome to the error a single PUT would return. */
export function writeOutcomeError(outcome: Exclude<PutOutcome, { status: 'written' }>, expectedRevision: number): ProductError {
  switch (outcome.status) {
    case 'not_found':
      return notFound('Document');
    case 'wrong_kb':
      return new ProductError(409, 'CONFLICT_ALREADY_EXISTS', 'Document id belongs to another knowledge base', false, { kind: 'already_exists' });
    case 'conflict':
      return new ProductError(409, 'CONFLICT_REVISION', 'Document revision conflict', false, {
        kind: 'revision_conflict', expected_revision: expectedRevision, actual_revision: outcome.actual,
      });
  }
}

export async function saveDocument(kbId: string, documentId: string, input: DocumentContent & { expected_revision: number }) {
  const { expected_revision, ...content } = input;
  return inKnowledgeTransaction(async client => {
    await requireKnowledgeBase(client, kbId);
    let outcome: PutOutcome;
    try {
      outcome = await putDocument(client, kbId, documentId, content, expected_revision);
    } catch (error) {
      throw error instanceof MetadataValidationError ? invalidMetadata(error) : error;
    }
    if (outcome.status !== 'written') throw writeOutcomeError(outcome, expected_revision);
    return {
      status: outcome.outcome === 'created' ? 201 : 200,
      data: { document_id: documentId, revision: outcome.revision, outcome: outcome.outcome },
    };
  });
}

export async function changeDocumentStatus(kbId: string, documentId: string, status: 'active' | 'archived', expectedRevision: number) {
  return inKnowledgeTransaction(async client => {
    await requireKnowledgeBase(client, kbId);
    const current = await lockDocument(client, documentId);
    if (!current || current.kb_id !== kbId) throw notFound('Document');
    if (current.revision !== expectedRevision) {
      throw writeOutcomeError({ status: 'conflict', actual: current.revision }, expectedRevision);
    }
    if (current.status !== status) await setDocumentStatus(client, documentId, status);
    return documentDetail(client, kbId, documentId);
  });
}

export async function retryDocumentRevision(kbId: string, documentId: string, revision: number) {
  return inKnowledgeTransaction(async client => {
    await requireKnowledgeBase(client, kbId);
    const current = await lockDocument(client, documentId);
    if (!current || current.kb_id !== kbId) throw notFound('Document');
    const revisionId = await findRevisionId(client, documentId, revision);
    if (!revisionId) throw notFound('Revision');
    if (!await retryRevision(client, revisionId)) {
      throw new ProductError(409, 'CONFLICT_INVALID_STATE', 'Only a revision that failed indexing can be retried', false, {
        kind: 'invalid_state',
      });
    }
    return documentDetail(client, kbId, documentId);
  });
}

export async function searchKnowledgeBase(kbId: string, input: SearchInput, ctx: { requestId: string; traceId: string }) {
  const { query, metadata_condition, ...setting } = input;
  const retrieval_setting = Object.fromEntries(Object.entries(setting).filter(([, value]) => value !== undefined));
  return retrieveKnowledge({ knowledge_id: kbId, query, retrieval_setting, ...(metadata_condition ? { metadata_condition } : {}) }, ctx);
}

export async function agentParams(kbId: string) {
  return withKnowledgeClient(async client => {
    await requireKnowledgeBase(client, kbId);
    const fields = await listFieldRows(client, kbId);
    return {
      'knowledge.search': {
        knowledge_base_id: kbId, top_k: 4, auto_filter_fields: fields.filter(field => field.filterable).map(field => field.name),
      },
      'knowledge.show': { display: fields.map(field => ({ field: field.name, label: field.label || field.name })) },
    };
  });
}
