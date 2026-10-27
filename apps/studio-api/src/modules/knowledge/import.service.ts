import { ProductError } from '@/http/errors';
import { inKnowledgeTransaction, withKnowledgeClient, type Queryable } from '@/infrastructure/db/knowledge-client';
import { computeContentHash } from '@/modules/experiences/canonical';
import { knowledgeContentHash } from '@/modules/knowledge/content-hash';
import { newId } from '@/modules/knowledge/ids';
import { ImportInputError, parseCsvRows, parseFiles, type ParsedRow } from '@/modules/knowledge/import';
import {
  documentContentSchema, type DocumentContent, type ImportCommitInput, type ImportPreviewInput,
} from '@/modules/knowledge/knowledge.schemas';
import {
  findImport, findLatestContent, insertImport, listFieldRows, type FieldRow,
} from '@/modules/knowledge/knowledge.repository';
import { requireKnowledgeBase } from '@/modules/knowledge/knowledge.service';
import { MetadataValidationError, namedMetadata, validateMetadata } from '@/modules/knowledge/metadata';
import { putDocument } from '@/modules/knowledge/writer';

export interface PreviewRowDTO {
  row: number;
  source: string;
  document_id: string | null;
  action: 'create' | 'update' | 'unchanged' | 'invalid';
  expected_revision: number | null;
  errors: string[];
  payload: DocumentContent | null;
}

type Outcome = 'created' | 'updated' | 'unchanged' | 'conflict' | 'failed';

export interface ImportReportDTO {
  import_id: string;
  created: number;
  updated: number;
  unchanged: number;
  conflict: number;
  failed: number;
  rows: Array<{ row: number; document_id: string; outcome: Outcome; revision: number | null; error: string | null }>;
}

function inputError(error: ImportInputError): ProductError {
  return new ProductError(422, 'VAL_INVALID_INPUT', error.message, false, {
    kind: 'validation', issues: [{ path: 'import', code: 'invalid_import', message: error.message, rule_id: null }],
  });
}

async function resolveRow(
  client: Queryable, kbId: string, fields: FieldRow[], parsed: ParsedRow, seen: Map<string, string>,
): Promise<PreviewRowDTO> {
  const invalid = (errors: string[]): PreviewRowDTO => ({
    row: parsed.row, source: parsed.source, document_id: parsed.documentId, action: 'invalid',
    expected_revision: null, errors, payload: null,
  });
  if (parsed.errors.length > 0) return invalid(parsed.errors);
  const documentId = parsed.documentId!;
  const earlier = seen.get(documentId);
  if (earlier) return invalid([`Trùng document_id với ${earlier}`]);
  seen.set(documentId, parsed.source);

  const existing = await findLatestContent(client, documentId);
  if (existing && existing.kb_id !== kbId) return invalid(['document_id đã thuộc knowledge base khác']);
  const metadata = Object.fromEntries(Object.entries({
    ...(existing ? namedMetadata(fields, existing.metadata) : {}),
    ...parsed.metadata,
  }).filter(([, value]) => value !== null && value !== undefined));
  const candidate = {
    title: parsed.title ?? existing?.title,
    body: parsed.body ?? existing?.body,
    source_url: parsed.sourceUrl === undefined ? existing?.source_url ?? null : parsed.sourceUrl,
    metadata,
  };
  if (candidate.title === undefined || candidate.body === undefined) return invalid(['Document mới cần cả title và body']);
  const checked = documentContentSchema.safeParse(candidate);
  if (!checked.success) return invalid(checked.error.issues.map(issue => `${issue.path.join('.') || 'payload'}: ${issue.message}`));
  let stored: Record<string, unknown>;
  try {
    stored = validateMetadata(fields, checked.data.metadata);
  } catch (error) {
    if (error instanceof MetadataValidationError) return invalid(error.issues.map(issue => `${issue.field}: ${issue.message}`));
    throw error;
  }
  const hash = knowledgeContentHash(checked.data.title, checked.data.body, checked.data.source_url, stored);
  return {
    row: parsed.row, source: parsed.source, document_id: documentId,
    action: !existing ? 'create' : existing.content_hash === hash ? 'unchanged' : 'update',
    expected_revision: existing?.revision ?? 0, errors: [], payload: checked.data,
  };
}

export async function previewImport(kbId: string, input: ImportPreviewInput): Promise<{ rows: PreviewRowDTO[] }> {
  return withKnowledgeClient(async client => {
    await requireKnowledgeBase(client, kbId);
    const fields = await listFieldRows(client, kbId);
    let parsed: ParsedRow[];
    try {
      parsed = input.kind === 'files' ? parseFiles(input.files) : parseCsvRows(input.content, input.mapping, fields);
    } catch (error) {
      throw error instanceof ImportInputError ? inputError(error) : error;
    }
    const seen = new Map<string, string>();
    const rows: PreviewRowDTO[] = [];
    for (const row of parsed) rows.push(await resolveRow(client, kbId, fields, row, seen));
    return { rows };
  });
}

function replay(stored: { request_hash: string; report: unknown }, requestHash: string): ImportReportDTO {
  if (stored.request_hash !== requestHash) {
    throw new ProductError(409, 'CONFLICT_IDEMPOTENCY_KEY', 'Idempotency key was used for a different import', false, {
      kind: 'idempotency_conflict',
    });
  }
  return stored.report as ImportReportDTO;
}

/**
 * One transaction per row, so a bad row never rolls back good ones. Two concurrent requests with the same key may
 * both write rows (the second then sees them as unchanged) and the first stored report wins. If the payloads differ,
 * the losing request answers 409 but may already have written its rows.
 */
export async function commitImport(kbId: string, input: ImportCommitInput, actor: string): Promise<ImportReportDTO> {
  const requestHash = computeContentHash(input.rows);
  const stored = await withKnowledgeClient(async client => {
    await requireKnowledgeBase(client, kbId);
    return findImport(client, kbId, input.idempotency_key);
  });
  if (stored) return replay(stored, requestHash);

  const report: ImportReportDTO = { import_id: newId('imp'), created: 0, updated: 0, unchanged: 0, conflict: 0, failed: 0, rows: [] };
  const record = (row: number, documentId: string, outcome: Outcome, revision: number | null, error: string | null) => {
    report[outcome] += 1;
    report.rows.push({ row, document_id: documentId, outcome, revision, error });
  };
  for (const item of input.rows) {
    try {
      const result = await inKnowledgeTransaction(client => putDocument(client, kbId, item.document_id, item.payload, item.expected_revision));
      if (result.status === 'written') record(item.row, item.document_id, result.outcome, result.revision, null);
      else if (result.status === 'conflict') {
        record(item.row, item.document_id, 'conflict', null, `Đã bị sửa sau lúc xem trước (revision ${result.actual}, xem trước ${item.expected_revision})`);
      } else {
        record(item.row, item.document_id, 'failed', null,
          result.status === 'wrong_kb' ? 'document_id đã thuộc knowledge base khác' : 'Document không còn tồn tại');
      }
    } catch (error) {
      if (!(error instanceof MetadataValidationError)) throw error;
      record(item.row, item.document_id, 'failed', null, error.issues.map(issue => `${issue.field}: ${issue.message}`).join('; '));
    }
  }

  const saved = await inKnowledgeTransaction(client => insertImport(client, {
    id: report.import_id, kbId, key: input.idempotency_key, requestHash, report, createdBy: actor,
  }));
  if (saved) return report;
  const winner = await withKnowledgeClient(client => findImport(client, kbId, input.idempotency_key));
  return replay(winner!, requestHash);
}
