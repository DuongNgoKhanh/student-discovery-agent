import type { Hono } from 'hono';
import { getProductDatabase } from '@/infrastructure/db/client';
import { honoHandler, withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { requireAdmin } from '@/modules/auth/auth.service';
import { readExperienceJsonBody } from '@/modules/experiences/body';
import { saveDraftSchema } from '@/modules/agent/agent.schemas';
import { readDraft, saveDraftContent } from '@/modules/agent/agent.service';

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

export function registerAgentRoutes(app: Hono): void {
  app.get(`${ADMIN}/draft`, honoHandler(handleReadDraft));
  app.put(`${ADMIN}/draft`, honoHandler(handleSaveDraft));
}
