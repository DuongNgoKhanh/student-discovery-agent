import { requireAdmin } from '@/server/auth/auth.service';
import { getProductDatabase } from '@/server/db/client';
import { readJsonBody } from '@/server/http/body';
import { withHandler } from '@/server/http/handler';
import { success } from '@/server/http/response';
import { queryOf } from '@/server/users/route-helpers';
import { adminCreateSchema, bulkDeleteSchema, userQuerySchema } from '@/server/users/users.schemas';
import { bulkDeleteUsers, createUser, listUsers, toNewUser } from '@/server/users/users.service';

export const runtime = 'nodejs';

export const GET = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  const { data, pagination } = await listUsers(getProductDatabase(), userQuerySchema.parse(queryOf(req)), true);
  return success(data, ctx, 200, { pagination });
});

export const POST = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  const input = adminCreateSchema.parse(await readJsonBody(req));
  return success(await createUser(getProductDatabase(), await toNewUser(input)), ctx);
});

export const DELETE = withHandler(async (req, ctx) => {
  await requireAdmin(req);
  const { user_ids } = bulkDeleteSchema.parse(await readJsonBody(req));
  const { data, ...rest } = await bulkDeleteUsers(getProductDatabase(), user_ids, ctx);
  return success(data, ctx, 200, rest);
});
