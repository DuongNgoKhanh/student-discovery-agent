import { requireAdmin } from '@/modules/auth/auth.service';
import { getProductDatabase } from '@/infrastructure/db/client';
import { readJsonBody } from '@/http/body';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { bulkDeleteSchema } from '@/modules/users/users.schemas';
import { bulkDeleteUsers } from '@/modules/users/users.service';


// POST, not DELETE: some proxies and clients drop DELETE request bodies.
export const handlePost = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  const { user_ids } = bulkDeleteSchema.parse(await readJsonBody(req));
  const { data, summary, ...rest } = await bulkDeleteUsers(getProductDatabase(), user_ids, ctx);
  return success(data, ctx, 200, { ...rest, meta: { summary } });
});
