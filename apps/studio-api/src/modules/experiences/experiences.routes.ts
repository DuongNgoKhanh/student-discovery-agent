import type { Hono } from 'hono';
import { getProductDatabase } from '@/infrastructure/db/client';
import { honoHandler, withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { requireAdmin } from '@/modules/auth/auth.service';
import { readExperienceJsonBody } from '@/modules/experiences/body';
import {
  createExperienceSchema,
  paginationQuerySchema,
  patchExperienceSchema,
  publishReleaseSchema,
  resourceIdSchema,
  saveDraftSchema,
} from '@/modules/experiences/experiences.schemas';
import {
  createExperience,
  getExperience,
  getExperienceRelease,
  listExperienceReleases,
  listExperiences,
  patchExperience,
  publishExperienceRelease,
  readExperienceDraft,
  saveExperienceDraft,
} from '@/modules/experiences/experiences.service';

const queryOf = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);

type IdParams = { id: string };
type ReleaseParams = { release_id: string };

export const handleListExperiences = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  const query = paginationQuerySchema.parse(queryOf(req));
  const data = await listExperiences(getProductDatabase(), query);
  return success(data, ctx);
});

export const handleCreateExperience = withHandler(async (req, ctx) => {
  const admin = await requireAdmin(req);
  const body = createExperienceSchema.parse(await readExperienceJsonBody(req));
  const res = await createExperience(getProductDatabase(), body, admin);
  return success(res.data, ctx, res.status);
});

export const handleGetExperience = withHandler<IdParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  const id = resourceIdSchema.parse(route.params.id);
  const data = await getExperience(getProductDatabase(), id);
  return success(data, ctx);
});

export const handlePatchExperience = withHandler<IdParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  const id = resourceIdSchema.parse(route.params.id);
  const body = patchExperienceSchema.parse(await readExperienceJsonBody(req));
  const res = await patchExperience(getProductDatabase(), id, body);
  return success(res.data, ctx, res.status);
});

export const handleReadExperienceDraft = withHandler<IdParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  const id = resourceIdSchema.parse(route.params.id);
  const data = await readExperienceDraft(getProductDatabase(), id);
  return success(data, ctx);
});

export const handleSaveExperienceDraft = withHandler<IdParams>(async (req, ctx, route) => {
  const admin = await requireAdmin(req);
  const id = resourceIdSchema.parse(route.params.id);
  const body = saveDraftSchema.parse(await readExperienceJsonBody(req));
  const res = await saveExperienceDraft(getProductDatabase(), id, body, admin);
  return success(res.data, ctx, res.status);
});

export const handlePublishExperienceRelease = withHandler<IdParams>(async (req, ctx, route) => {
  const admin = await requireAdmin(req);
  const id = resourceIdSchema.parse(route.params.id);
  const body = publishReleaseSchema.parse(await readExperienceJsonBody(req));
  const res = await publishExperienceRelease(getProductDatabase(), id, body, admin);
  return success(res.data, ctx, res.status);
});

export const handleListExperienceReleases = withHandler<IdParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  const id = resourceIdSchema.parse(route.params.id);
  const query = paginationQuerySchema.parse(queryOf(req));
  const data = await listExperienceReleases(getProductDatabase(), id, query);
  return success(data, ctx);
});

export const handleReadExperienceRelease = withHandler<ReleaseParams>(async (req, ctx, route) => {
  await requireAdmin(req);
  const releaseId = resourceIdSchema.parse(route.params.release_id);
  const data = await getExperienceRelease(getProductDatabase(), releaseId);
  return success(data, ctx);
});

export function registerExperiencesRoutes(app: Hono): void {
  app.get('/api/v1/admin/experiences', honoHandler(handleListExperiences));
  app.post('/api/v1/admin/experiences', honoHandler(handleCreateExperience));
  app.get('/api/v1/admin/experiences/:id', honoHandler(handleGetExperience));
  app.patch('/api/v1/admin/experiences/:id', honoHandler(handlePatchExperience));
  app.get('/api/v1/admin/experiences/:id/draft', honoHandler(handleReadExperienceDraft));
  app.put('/api/v1/admin/experiences/:id/draft', honoHandler(handleSaveExperienceDraft));
  app.post('/api/v1/admin/experiences/:id/releases', honoHandler(handlePublishExperienceRelease));
  app.get('/api/v1/admin/experiences/:id/releases', honoHandler(handleListExperienceReleases));
  app.get('/api/v1/admin/experience-releases/:release_id', honoHandler(handleReadExperienceRelease));
}

