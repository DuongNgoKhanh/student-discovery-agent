import type { Hono } from 'hono';
import { z } from 'zod';
import { honoHandler, withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { requireAdmin } from '@/modules/auth/auth.service';
import { readExperienceJsonBody } from '@/modules/experiences/body';
import {
  createFieldSchema, createKnowledgeBaseSchema, documentIdSchema, fieldNameSchema, importCommitSchema, importPreviewSchema,
  kbIdSchema, listDocumentsQuerySchema, patchFieldSchema, patchKnowledgeBaseSchema, putDocumentSchema, searchSchema,
  statusChangeSchema,
} from '@/modules/knowledge/knowledge.schemas';
import {
  agentParams, changeDocumentStatus, createField, createKnowledgeBase, deleteField, getDocument, getKnowledgeBase, listDocuments,
  listFields, listKnowledgeBases, patchField, patchKnowledgeBase, retryDocumentRevision, saveDocument,
  searchKnowledgeBase,
} from '@/modules/knowledge/knowledge.service';
import { commitImport, previewImport } from '@/modules/knowledge/import.service';

export const KB_BASE = '/api/v1/admin/knowledge-bases';
const SMALL_BODY = 64 * 1024;

type KbParams = { kb_id: string };
type FieldParams = KbParams & { field_name: string };

export const handleListKnowledgeBases = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  return success({ items: await listKnowledgeBases() }, ctx);
});

export const handleCreateKnowledgeBase = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  const body = createKnowledgeBaseSchema.parse(await readExperienceJsonBody(req, { maxBytes: SMALL_BODY }));
  return success(await createKnowledgeBase(body), ctx, 201);
});

export const handleGetKnowledgeBase = withHandler<KbParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  return success(await getKnowledgeBase(kbIdSchema.parse(route.params.kb_id)), ctx);
});

export const handlePatchKnowledgeBase = withHandler<KbParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  const id = kbIdSchema.parse(route.params.kb_id);
  const body = patchKnowledgeBaseSchema.parse(await readExperienceJsonBody(req, { maxBytes: SMALL_BODY }));
  return success(await patchKnowledgeBase(id, body), ctx);
});

export const handleListFields = withHandler<KbParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  return success({ items: await listFields(kbIdSchema.parse(route.params.kb_id)) }, ctx);
});

export const handleCreateField = withHandler<KbParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  const kbId = kbIdSchema.parse(route.params.kb_id);
  const body = createFieldSchema.parse(await readExperienceJsonBody(req, { maxBytes: SMALL_BODY }));
  return success(await createField(kbId, body), ctx, 201);
});

export const handlePatchField = withHandler<FieldParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  const kbId = kbIdSchema.parse(route.params.kb_id);
  const name = fieldNameSchema.parse(route.params.field_name);
  const body = patchFieldSchema.parse(await readExperienceJsonBody(req, { maxBytes: SMALL_BODY }));
  return success(await patchField(kbId, name, body), ctx);
});

export const handleDeleteField = withHandler<FieldParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  const kbId = kbIdSchema.parse(route.params.kb_id);
  const name = fieldNameSchema.parse(route.params.field_name);
  return success(await deleteField(kbId, name), ctx);
});

const DOCUMENT_BODY = 512 * 1024;
type DocParams = KbParams & { document_id: string };
type RevisionParams = DocParams & { revision: string };
const revisionParamSchema = z.coerce.number().int().min(1);
const queryOf = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);

export const handleListDocuments = withHandler<KbParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  const kbId = kbIdSchema.parse(route.params.kb_id);
  const query = listDocumentsQuerySchema.parse(queryOf(req));
  const { items, next_cursor } = await listDocuments(kbId, query);
  return success({ items }, ctx, 200, { meta: { pagination: { limit: query.limit, next_cursor, has_more: next_cursor !== null } } });
});

export const handleGetDocument = withHandler<DocParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  return success(await getDocument(kbIdSchema.parse(route.params.kb_id), documentIdSchema.parse(route.params.document_id)), ctx);
});

export const handlePutDocument = withHandler<DocParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  const kbId = kbIdSchema.parse(route.params.kb_id);
  const documentId = documentIdSchema.parse(route.params.document_id);
  const body = putDocumentSchema.parse(await readExperienceJsonBody(req, { maxBytes: DOCUMENT_BODY }));
  const result = await saveDocument(kbId, documentId, body);
  return success(result.data, ctx, result.status);
});

const statusHandler = (status: 'active' | 'archived') => withHandler<DocParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  const kbId = kbIdSchema.parse(route.params.kb_id);
  const documentId = documentIdSchema.parse(route.params.document_id);
  const body = statusChangeSchema.parse(await readExperienceJsonBody(req, { maxBytes: SMALL_BODY }));
  return success(await changeDocumentStatus(kbId, documentId, status, body.expected_revision), ctx);
});
export const handleArchiveDocument = statusHandler('archived');
export const handleRestoreDocument = statusHandler('active');

export const handleRetryRevision = withHandler<RevisionParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  await readExperienceJsonBody(req, { optional: true, maxBytes: SMALL_BODY });
  const kbId = kbIdSchema.parse(route.params.kb_id);
  const documentId = documentIdSchema.parse(route.params.document_id);
  const revision = revisionParamSchema.parse(route.params.revision);
  return success(await retryDocumentRevision(kbId, documentId, revision), ctx);
});

const IMPORT_BODY = 5 * 1024 * 1024;

export const handlePreviewImport = withHandler<KbParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  const kbId = kbIdSchema.parse(route.params.kb_id);
  const body = importPreviewSchema.parse(await readExperienceJsonBody(req, { maxBytes: IMPORT_BODY }));
  return success(await previewImport(kbId, body), ctx);
});

export const handleCommitImport = withHandler<KbParams>(async (req, ctx, route) => {
  const actor = await requireAdmin(req);
  const kbId = kbIdSchema.parse(route.params.kb_id);
  const body = importCommitSchema.parse(await readExperienceJsonBody(req, { maxBytes: IMPORT_BODY }));
  return success(await commitImport(kbId, body, actor.sub), ctx);
});

export const handleSearch = withHandler<KbParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  const kbId = kbIdSchema.parse(route.params.kb_id);
  const body = searchSchema.parse(await readExperienceJsonBody(req, { maxBytes: SMALL_BODY }));
  return success(await searchKnowledgeBase(kbId, body, ctx), ctx);
});

export const handleAgentParams = withHandler<KbParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  return success(await agentParams(kbIdSchema.parse(route.params.kb_id)), ctx);
});

export function registerKnowledgeRoutes(app: Hono): void {
  app.get(KB_BASE, honoHandler(handleListKnowledgeBases));
  app.post(KB_BASE, honoHandler(handleCreateKnowledgeBase));
  app.get(`${KB_BASE}/:kb_id`, honoHandler(handleGetKnowledgeBase));
  app.patch(`${KB_BASE}/:kb_id`, honoHandler(handlePatchKnowledgeBase));
  app.get(`${KB_BASE}/:kb_id/fields`, honoHandler(handleListFields));
  app.post(`${KB_BASE}/:kb_id/fields`, honoHandler(handleCreateField));
  app.patch(`${KB_BASE}/:kb_id/fields/:field_name`, honoHandler(handlePatchField));
  app.delete(`${KB_BASE}/:kb_id/fields/:field_name`, honoHandler(handleDeleteField));
  app.get(`${KB_BASE}/:kb_id/documents`, honoHandler(handleListDocuments));
  app.get(`${KB_BASE}/:kb_id/documents/:document_id`, honoHandler(handleGetDocument));
  app.put(`${KB_BASE}/:kb_id/documents/:document_id`, honoHandler(handlePutDocument));
  app.post(`${KB_BASE}/:kb_id/documents/:document_id/archive`, honoHandler(handleArchiveDocument));
  app.post(`${KB_BASE}/:kb_id/documents/:document_id/restore`, honoHandler(handleRestoreDocument));
  app.post(`${KB_BASE}/:kb_id/documents/:document_id/revisions/:revision/retry`, honoHandler(handleRetryRevision));
  app.post(`${KB_BASE}/:kb_id/imports/preview`, honoHandler(handlePreviewImport));
  app.post(`${KB_BASE}/:kb_id/imports`, honoHandler(handleCommitImport));
  app.post(`${KB_BASE}/:kb_id/search`, honoHandler(handleSearch));
  app.get(`${KB_BASE}/:kb_id/agent-params`, honoHandler(handleAgentParams));
}
