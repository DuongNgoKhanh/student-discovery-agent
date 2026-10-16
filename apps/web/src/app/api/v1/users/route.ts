import { requireUser } from '@/server/auth/auth.service';
import { getProductDatabase } from '@/server/db/client';
import { withHandler } from '@/server/http/handler';
import { success } from '@/server/http/response';
import { adminToPublic } from '@/server/users/users.profile';
import { queryOf } from '@/server/users/route-helpers';
import { userQuerySchema } from '@/server/users/users.schemas';
import { listUsers } from '@/server/users/users.service';

export const runtime = 'nodejs';

export const GET = withHandler(async (req, ctx) => {
  const db = getProductDatabase();
  await requireUser(req, db);
  const { data, pagination } = await listUsers(db, userQuerySchema.parse(queryOf(req)), false);
  const users = data.map(adminToPublic);
  return success(users, ctx, 200, { pagination });
});
