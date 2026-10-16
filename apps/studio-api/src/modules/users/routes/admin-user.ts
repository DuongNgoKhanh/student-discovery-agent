import { requireAdmin } from '@/modules/auth/auth.service';
import { getProductDatabase } from '@/infrastructure/db/client';
import { readJsonBody } from '@/http/body';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { userIdParam } from '@/modules/users/route-helpers';
import { toAdminProfile } from '@/modules/users/users.profile';
import { findUserById } from '@/modules/users/users.repository';
import { adminUpdateSchema } from '@/modules/users/users.schemas';
import { softDeleteUser, toPatch, updateUser } from '@/modules/users/users.service';
import { ProductError } from '@/http/errors';


type P = { user_id: string };

export const handleGet = withHandler<P>(async (req, ctx, route) => {
  await requireAdmin(req);
  const row = await findUserById(getProductDatabase(), await userIdParam(route), true);
  if (!row) throw new ProductError(404, 'RES_USER_NOT_FOUND', 'User not found');
  return success(toAdminProfile(row), ctx);
});

export const handlePut = withHandler<P>(async (req, ctx, route) => {
  await requireAdmin(req);
  const id = await userIdParam(route);
  const input = adminUpdateSchema.parse(await readJsonBody(req));
  return success(await updateUser(getProductDatabase(), id, await toPatch(input)), ctx);
});

export const handleDelete = withHandler<P>(async (req, ctx, route) => {
  await requireAdmin(req);
  await softDeleteUser(getProductDatabase(), await userIdParam(route));
  return success(null, ctx);
});
