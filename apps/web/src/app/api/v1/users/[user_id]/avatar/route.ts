import { getProductDatabase } from '@/server/db/client';
import { ProductError } from '@/server/http/errors';
import { withHandler } from '@/server/http/handler';
import { readAvatar } from '@/server/users/avatar.service';
import { userIdParam } from '@/server/users/route-helpers';

export const runtime = 'nodejs';

export const GET = withHandler<{ user_id: string }>(async (_req, _ctx, route) => {
  const obj = await readAvatar(getProductDatabase(), await userIdParam(route));
  if (!obj) throw new ProductError(404, 'RES_AVATAR_NOT_FOUND', 'Avatar not found');
  return new Response(obj.body, {
    headers: { 'content-type': obj.contentType, 'content-length': String(obj.size), 'content-disposition': 'inline' },
  });
});
