import { getProductDatabase } from '@/server/db/client';
import { readJsonBody } from '@/server/http/body';
import { ProductError } from '@/server/http/errors';
import { withHandler } from '@/server/http/handler';
import { success } from '@/server/http/response';
import { versionCreateSchema } from '@/server/versions/versions.schemas';
import { createVersion, getCurrentVersion } from '@/server/versions/versions.service';

export const runtime = 'nodejs';

export const GET = withHandler(async (_req, ctx) => {
  const current = await getCurrentVersion(getProductDatabase());
  if (!current) throw new ProductError(404, 'RES_VERSION_NOT_FOUND', 'No current version');
  return success(current, ctx);
});

export const POST = withHandler(async (req, ctx) => {
  const input = versionCreateSchema.parse(await readJsonBody(req));
  return success(await createVersion(getProductDatabase(), input), ctx, 201);
});
