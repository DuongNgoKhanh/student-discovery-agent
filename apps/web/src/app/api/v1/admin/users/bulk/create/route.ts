import { requireAdmin } from '@/server/auth/auth.service';
import { getProductDatabase } from '@/server/db/client';
import { readJsonBody } from '@/server/http/body';
import { withHandler } from '@/server/http/handler';
import { success } from '@/server/http/response';
import { bulkCreateSchema } from '@/server/users/users.schemas';
import { bulkCreateUsers } from '@/server/users/users.service';

export const runtime = 'nodejs';

export const POST = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  const { users } = bulkCreateSchema.parse(await readJsonBody(req));
  const { data, ...rest } = await bulkCreateUsers(getProductDatabase(), users, ctx);
  return success(data, ctx, 200, rest);
});
