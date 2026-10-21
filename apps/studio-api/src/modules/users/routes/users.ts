import { requireUser } from '@/modules/auth/auth.service';
import { getProductDatabase } from '@/infrastructure/db/client';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { adminToPublic } from '@/modules/users/users.profile';
import { queryOf } from '@/modules/users/route-helpers';
import { publicUserQuerySchema } from '@/modules/users/users.schemas';
import { listUsers } from '@/modules/users/users.service';


export const handleGet = withHandler(async (req, ctx) => {
  const db = getProductDatabase();
  await requireUser(req, db);
  const { data, pagination } = await listUsers(db, publicUserQuerySchema.parse(queryOf(req)), false);
  const users = data.map(adminToPublic);
  return success({ items: users }, ctx, 200, { meta: { pagination } });
});
