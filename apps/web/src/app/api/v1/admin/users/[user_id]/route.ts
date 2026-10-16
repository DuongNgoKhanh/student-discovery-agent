import { requireAdmin } from '@/server/auth/auth.service';
import { getProductDatabase } from '@/server/db/client';
import { readJsonBody } from '@/server/http/body';
import { withHandler } from '@/server/http/handler';
import { success } from '@/server/http/response';
import { userIdParam } from '@/server/users/route-helpers';
import { toAdminProfile } from '@/server/users/users.profile';
import { findUserById } from '@/server/users/users.repository';
import { adminUpdateSchema } from '@/server/users/users.schemas';
import { softDeleteUser, toPatch, updateUser } from '@/server/users/users.service';
import { ProductError } from '@/server/http/errors';

export const runtime = 'nodejs';

type P = { user_id: string };

export const GET = withHandler<P>(async (req, ctx, route) => {
  await requireAdmin(req);
  const row = await findUserById(getProductDatabase(), await userIdParam(route), true);
  if (!row) throw new ProductError(404, 'RES_USER_NOT_FOUND', 'User not found');
  return success(toAdminProfile(row), ctx);
});

export const PUT = withHandler<P>(async (req, ctx, route) => {
  await requireAdmin(req);
  const id = await userIdParam(route);
  const input = adminUpdateSchema.parse(await readJsonBody(req));
  return success(await updateUser(getProductDatabase(), id, await toPatch(input)), ctx);
});

export const DELETE = withHandler<P>(async (req, ctx, route) => {
  await requireAdmin(req);
  await softDeleteUser(getProductDatabase(), await userIdParam(route));
  return success(null, ctx);
});
