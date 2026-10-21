import { requireAdmin } from '@/modules/auth/auth.service';
import { getProductDatabase } from '@/infrastructure/db/client';
import { readJsonBody } from '@/http/body';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { bulkCreateSchema } from '@/modules/users/users.schemas';
import { bulkCreateUsers } from '@/modules/users/users.service';


export const handlePost = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  const { users } = bulkCreateSchema.parse(await readJsonBody(req));
  const { data, summary, ...rest } = await bulkCreateUsers(getProductDatabase(), users, ctx);
  return success(data, ctx, 200, { ...rest, meta: { summary } });
});
