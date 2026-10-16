import { getProductDatabase } from '@/infrastructure/db/client';
import { readJsonBody } from '@/http/body';
import { ProductError } from '@/http/errors';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { versionCreateSchema } from '@/modules/versions/versions.schemas';
import { createVersion, getCurrentVersion } from '@/modules/versions/versions.service';


export const handleGet = withHandler(async (_req, ctx) => {
  const current = await getCurrentVersion(getProductDatabase());
  if (!current) throw new ProductError(404, 'RES_VERSION_NOT_FOUND', 'No current version');
  return success(current, ctx);
});

export const handlePost = withHandler(async (req, ctx) => {
  const input = versionCreateSchema.parse(await readJsonBody(req));
  return success(await createVersion(getProductDatabase(), input), ctx, 201);
});
