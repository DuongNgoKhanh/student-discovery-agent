import type { Queryable } from '@/infrastructure/db/knowledge-client';
import type { FieldType } from '@/modules/knowledge/metadata';

export interface KnowledgeBaseRow {
  id: string;
  name: string;
  description: string;
  embedding_model: string;
  document_count: number;
  error_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface FieldRow {
  id: string;
  kb_id: string;
  name: string;
  type: FieldType;
  label: string;
  filterable: boolean;
  ordinal: number;
}

const KB_SELECT = `SELECT kb.id, kb.name, kb.description, kb.embedding_model, kb.created_at, kb.updated_at,
  (SELECT count(*)::int FROM knowledge.documents d WHERE d.kb_id = kb.id AND d.status = 'active') AS document_count,
  (SELECT count(*)::int FROM knowledge.documents d JOIN knowledge.document_revisions r ON r.id = d.latest_revision_id
     WHERE d.kb_id = kb.id AND d.status = 'active' AND r.index_status = 'error') AS error_count
  FROM knowledge.knowledge_bases kb`;

export async function listKnowledgeBaseRows(client: Queryable): Promise<KnowledgeBaseRow[]> {
  return (await client.query<KnowledgeBaseRow>(`${KB_SELECT} ORDER BY kb.name, kb.id`)).rows;
}

export async function findKnowledgeBase(client: Queryable, id: string): Promise<KnowledgeBaseRow | null> {
  return (await client.query<KnowledgeBaseRow>(`${KB_SELECT} WHERE kb.id = $1`, [id])).rows[0] ?? null;
}

export async function insertKnowledgeBase(
  client: Queryable,
  row: { id: string; name: string; description: string; embedding_model: string },
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO knowledge.knowledge_bases (id, name, description, embedding_model) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [row.id, row.name, row.description, row.embedding_model],
  );
  return result.rowCount === 1;
}

export async function updateKnowledgeBase(
  client: Queryable,
  id: string,
  patch: { name?: string; description?: string },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE knowledge.knowledge_bases SET name = COALESCE($2, name), description = COALESCE($3, description),
       updated_at = clock_timestamp() WHERE id = $1`,
    [id, patch.name ?? null, patch.description ?? null],
  );
  return result.rowCount === 1;
}

const FIELD_COLUMNS = 'id, kb_id, name, type, label, filterable, ordinal';

export async function listFieldRows(client: Queryable, kbId: string): Promise<FieldRow[]> {
  return (await client.query<FieldRow>(
    `SELECT ${FIELD_COLUMNS} FROM knowledge.metadata_fields WHERE kb_id = $1 ORDER BY ordinal, name`, [kbId],
  )).rows;
}

export async function insertField(client: Queryable, row: FieldRow): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO knowledge.metadata_fields (${FIELD_COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (kb_id, name) DO NOTHING RETURNING id`,
    [row.id, row.kb_id, row.name, row.type, row.label, row.filterable, row.ordinal],
  );
  return result.rowCount === 1;
}

export async function lockField(client: Queryable, kbId: string, name: string): Promise<FieldRow | null> {
  return (await client.query<FieldRow>(
    `SELECT ${FIELD_COLUMNS} FROM knowledge.metadata_fields WHERE kb_id = $1 AND name = $2 FOR UPDATE`, [kbId, name],
  )).rows[0] ?? null;
}

export async function updateField(
  client: Queryable,
  id: string,
  patch: { label?: string; filterable?: boolean; ordinal?: number },
): Promise<FieldRow> {
  return (await client.query<FieldRow>(
    `UPDATE knowledge.metadata_fields SET label = COALESCE($2, label), filterable = COALESCE($3, filterable),
       ordinal = COALESCE($4, ordinal) WHERE id = $1 RETURNING ${FIELD_COLUMNS}`,
    [id, patch.label ?? null, patch.filterable ?? null, patch.ordinal ?? null],
  )).rows[0]!;
}

/** Active documents whose latest revision stores a value for the field (archived ones never reach the agent). */
export async function countDocumentsUsingField(client: Queryable, kbId: string, fieldId: string): Promise<number> {
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM knowledge.documents d
       JOIN knowledge.document_revisions r ON r.id = d.latest_revision_id
     WHERE d.kb_id = $1 AND d.status = 'active' AND r.metadata ? $2`,
    [kbId, fieldId],
  );
  return result.rows[0]!.count;
}

export async function deleteField(client: Queryable, id: string): Promise<void> {
  await client.query('DELETE FROM knowledge.metadata_fields WHERE id = $1', [id]);
}
