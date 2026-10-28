import type { Hono } from 'hono';
import { z } from 'zod';
import { getProductDatabase } from '@/infrastructure/db/client';
import { honoHandler, withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { requireAdmin } from '@/modules/auth/auth.service';
import { readExperienceJsonBody } from '@/modules/experiences/body';
import { ProductError } from '@/http/errors';
import { paginationSchema, publishSchema, releaseIdSchema, restoreSchema, saveDraftSchema } from '@/modules/agent/agent.schemas';
import { verifyDeliveryRequest } from '@/modules/agent/delivery-auth';
import {
  activeDescriptor, getActiveAgent, getAgentRelease, listAgentAudit, listAgentReleases, publish, readDraft, restore, saveDraftContent, validateDraft,
} from '@/modules/agent/agent.service';

const ADMIN = '/api/v1/admin/agent';
// Agent configs carry long system prompts; 256 KB keeps them well inside the body cap.
const BODY = { maxBytes: 256 * 1024 };

export const handleReadDraft = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  return success(await readDraft(getProductDatabase()), ctx);
});

export const handleSaveDraft = withHandler(async (req, ctx) => {
  const admin = await requireAdmin(req);
  const body = saveDraftSchema.parse(await readExperienceJsonBody(req, BODY));
  return success(await saveDraftContent(getProductDatabase(), body, admin.sub), ctx);
});

export const handleValidateDraft = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  return success(await validateDraft(getProductDatabase(), ctx), ctx);
});

const queryOf = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);
const pageMeta = (limit: number, next_cursor: string | null) => ({ meta: { pagination: { limit, next_cursor, has_more: next_cursor !== null } } });

export const handlePublish = withHandler(async (req, ctx) => {
  const admin = await requireAdmin(req);
  const body = publishSchema.parse(await readExperienceJsonBody(req));
  const res = await publish(getProductDatabase(), body, admin.sub, ctx);
  return success(res.data, ctx, res.status);
});

// Hono cannot express `/:id:restore`; the param captures the suffix and is split here.
export const handleReleaseAction = withHandler<{ release: string }>(async (req, ctx, route) => {
  const admin = await requireAdmin(req);
  const match = /^(agr_[0-9a-f]{24}):restore$/.exec(route.params.release);
  if (!match) throw new ProductError(404, 'RES_NOT_FOUND', 'Not found');
  const body = restoreSchema.parse(await readExperienceJsonBody(req));
  const res = await restore(getProductDatabase(), match[1]!, body, admin.sub, ctx);
  return success(res.data, ctx, res.status);
});

export const handleListReleases = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  const query = paginationSchema.parse(queryOf(req));
  const { items, next_cursor } = await listAgentReleases(getProductDatabase(), query);
  return success({ items }, ctx, 200, pageMeta(query.limit, next_cursor));
});

export const handleReadRelease = withHandler<{ release: string }>(async (req, ctx, route) => {
  await requireAdmin(req);
  return success(await getAgentRelease(getProductDatabase(), releaseIdSchema.parse(route.params.release)), ctx);
});

export const handleReadActive = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  return success(await getActiveAgent(getProductDatabase()), ctx);
});

export const handleListAudit = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  const query = paginationSchema.parse(queryOf(req));
  const { items, next_cursor } = await listAgentAudit(getProductDatabase(), query);
  return success({ items }, ctx, 200, pageMeta(query.limit, next_cursor));
});

const deliveryQuery = z.object({ kind: z.literal('agent'), environment: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/) }).strict();

export const handleActiveDelivery = withHandler(async (req, ctx) => {
  await verifyDeliveryRequest(req, '');
  const parsed = deliveryQuery.safeParse(queryOf(req));
  if (!parsed.success) throw new ProductError(422, 'VAL_INVALID_REQUEST', 'Only kind=agent is delivered');
  return success(await activeDescriptor(getProductDatabase(), parsed.data.environment), ctx);
});

export function registerAgentRoutes(app: Hono): void {
  app.get(`${ADMIN}/draft`, honoHandler(handleReadDraft));
  app.put(`${ADMIN}/draft`, honoHandler(handleSaveDraft));
  app.post(`${ADMIN}/draft/validations`, honoHandler(handleValidateDraft));
  app.post(`${ADMIN}/releases`, honoHandler(handlePublish));
  app.get(`${ADMIN}/releases`, honoHandler(handleListReleases));
  app.get(`${ADMIN}/releases/:release`, honoHandler(handleReadRelease));
  app.post(`${ADMIN}/releases/:release`, honoHandler(handleReleaseAction));
  app.get(`${ADMIN}/active`, honoHandler(handleReadActive));
  app.get(`${ADMIN}/audit-logs`, honoHandler(handleListAudit));
  app.get('/api/v1/internal/releases/active', honoHandler(handleActiveDelivery));
}
