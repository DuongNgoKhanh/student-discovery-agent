import type { Hono } from 'hono';
import { honoHandler, withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { requireAdmin } from '@/modules/auth/auth.service';
import { readExperienceJsonBody } from '@/modules/experiences/body';
import {
  createFieldSchema, createKnowledgeBaseSchema, fieldNameSchema, kbIdSchema, patchFieldSchema, patchKnowledgeBaseSchema,
} from '@/modules/knowledge/knowledge.schemas';
import {
  createField, createKnowledgeBase, deleteField, getKnowledgeBase, listFields, listKnowledgeBases, patchField,
  patchKnowledgeBase,
} from '@/modules/knowledge/knowledge.service';

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

export function registerKnowledgeRoutes(app: Hono): void {
  app.get(KB_BASE, honoHandler(handleListKnowledgeBases));
  app.post(KB_BASE, honoHandler(handleCreateKnowledgeBase));
  app.get(`${KB_BASE}/:kb_id`, honoHandler(handleGetKnowledgeBase));
  app.patch(`${KB_BASE}/:kb_id`, honoHandler(handlePatchKnowledgeBase));
  app.get(`${KB_BASE}/:kb_id/fields`, honoHandler(handleListFields));
  app.post(`${KB_BASE}/:kb_id/fields`, honoHandler(handleCreateField));
  app.patch(`${KB_BASE}/:kb_id/fields/:field_name`, honoHandler(handlePatchField));
  app.delete(`${KB_BASE}/:kb_id/fields/:field_name`, honoHandler(handleDeleteField));
}
