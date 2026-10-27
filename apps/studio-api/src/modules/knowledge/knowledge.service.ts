import { getKnowledgeEnv } from '@/config/env';
import { ProductError } from '@/http/errors';
import { inKnowledgeTransaction, withKnowledgeClient, type Queryable } from '@/infrastructure/db/knowledge-client';
import type {
  CreateFieldInput, CreateKnowledgeBaseInput, PatchFieldInput, PatchKnowledgeBaseInput,
} from '@/modules/knowledge/knowledge.schemas';
import {
  countDocumentsUsingField, deleteField as deleteFieldRow, findKnowledgeBase, insertField, insertKnowledgeBase,
  listFieldRows, listKnowledgeBaseRows, lockField, updateField, updateKnowledgeBase,
  type FieldRow, type KnowledgeBaseRow,
} from '@/modules/knowledge/knowledge.repository';
import { newId } from '@/modules/knowledge/ids';
import { slugify } from '@/modules/knowledge/slug';

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
