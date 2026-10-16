import { requireAdmin } from '@/modules/auth/auth.service';
import { getProductDatabase } from '@/infrastructure/db/client';
import { readJsonBody } from '@/http/body';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { queryOf } from '@/modules/users/route-helpers';
import { adminCreateSchema, bulkDeleteSchema, userQuerySchema } from '@/modules/users/users.schemas';
import { bulkDeleteUsers, createUser, listUsers, toNewUser } from '@/modules/users/users.service';


export const handleGet = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  const { data, pagination } = await listUsers(getProductDatabase(), userQuerySchema.parse(queryOf(req)), true);
  return success(data, ctx, 200, { pagination });
});

export const handlePost = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  const input = adminCreateSchema.parse(await readJsonBody(req));
  return success(await createUser(getProductDatabase(), await toNewUser(input)), ctx);
});

export const handleDelete = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  const { user_ids } = bulkDeleteSchema.parse(await readJsonBody(req));
  const { data, ...rest } = await bulkDeleteUsers(getProductDatabase(), user_ids, ctx);
  return success(data, ctx, 200, rest);
});
