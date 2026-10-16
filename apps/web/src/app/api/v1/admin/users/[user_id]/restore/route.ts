import { requireAdmin } from '@/server/auth/auth.service';
import { getProductDatabase } from '@/server/db/client';
import { withHandler } from '@/server/http/handler';
import { success } from '@/server/http/response';
import { userIdParam } from '@/server/users/route-helpers';
import { restoreUser } from '@/server/users/users.service';

export const runtime = 'nodejs';

export const POST = withHandler<{ user_id: string }>(async (req, ctx, route) => {
  await requireAdmin(req);
  return success(await restoreUser(getProductDatabase(), await userIdParam(route)), ctx);
});
