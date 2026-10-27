import type { Queryable } from '@/infrastructure/db/knowledge-client';
import { knowledgeContentHash } from '@/modules/knowledge/content-hash';
import type { DocumentContent } from '@/modules/knowledge/knowledge.schemas';
import type { FieldRow } from '@/modules/knowledge/knowledge.repository';
import { newId } from '@/modules/knowledge/ids';
import { validateMetadata } from '@/modules/knowledge/metadata';

export type PutOutcome =
  | { status: 'written'; outcome: 'created' | 'updated' | 'unchanged'; revision: number }
  | { status: 'conflict'; actual: number }
  | { status: 'not_found' }
  | { status: 'wrong_kb' };

/**
 * Port of KnowledgeWriter.put_document plus optimistic concurrency. Must run inside a transaction:
 * the document row is locked until commit, and the revision trigger wakes the indexer.
 */
export async function putDocument(
  client: Queryable,
  kbId: string,
  documentId: string,
  content: DocumentContent,
  expectedRevision: number,
): Promise<PutOutcome> {
  // Share lock: a concurrent field delete must wait for this transaction instead of orphaning stored values.
  const fields = (await client.query<FieldRow>(
    `SELECT id, kb_id, name, type, label, filterable, ordinal FROM knowledge.metadata_fields
     WHERE kb_id = $1 ORDER BY ordinal, name FOR SHARE`,
    [kbId],
  )).rows;
  const stored = validateMetadata(fields, content.metadata);
  const hash = knowledgeContentHash(content.title, content.body, content.source_url, stored);
  if (expectedRevision === 0) {
    await client.query(
      'INSERT INTO knowledge.documents (id, kb_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [documentId, kbId],
    );
  }
  const current = (await client.query<{ kb_id: string; revision: number; content_hash: string | null }>(
    `SELECT d.kb_id, d.revision::int AS revision, r.content_hash FROM knowledge.documents d
       LEFT JOIN knowledge.document_revisions r ON r.id = d.latest_revision_id
     WHERE d.id = $1 FOR UPDATE OF d`,
    [documentId],
  )).rows[0];
  if (!current) return { status: 'not_found' };
  if (current.kb_id !== kbId) return { status: 'wrong_kb' };
  // Identical content is a no-op even with a stale expected_revision, like the Python writer; this also makes a
  // re-sent import report rows it already wrote as unchanged instead of conflicts.
  if (current.content_hash === hash) return { status: 'written', outcome: 'unchanged', revision: current.revision };
  if (current.revision !== expectedRevision) return { status: 'conflict', actual: current.revision };
  const revision = current.revision + 1;
  const revisionId = newId('rev');
  await client.query(
    `INSERT INTO knowledge.document_revisions (id, document_id, revision, title, body, source_url, metadata, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [revisionId, documentId, revision, content.title, content.body, content.source_url, JSON.stringify(stored), hash],
  );
  await client.query(
    `UPDATE knowledge.documents SET revision = $2, latest_revision_id = $3, updated_at = clock_timestamp() WHERE id = $1`,
    [documentId, revision, revisionId],
  );
  return { status: 'written', outcome: revision === 1 ? 'created' : 'updated', revision };
}
