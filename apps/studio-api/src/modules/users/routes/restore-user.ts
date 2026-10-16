import { requireAdmin } from '@/modules/auth/auth.service';
import { getProductDatabase } from '@/infrastructure/db/client';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { userIdParam } from '@/modules/users/route-helpers';
import { restoreUser } from '@/modules/users/users.service';


export const handlePost = withHandler<{ user_id: string }>(async (req, ctx, route) => {
  await requireAdmin(req);
  return success(await restoreUser(getProductDatabase(), await userIdParam(route)), ctx);
});
