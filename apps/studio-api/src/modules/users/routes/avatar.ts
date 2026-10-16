import { getProductDatabase } from '@/infrastructure/db/client';
import { ProductError } from '@/http/errors';
import { withHandler } from '@/http/handler';
import { readAvatar } from '@/modules/users/avatar.service';
import { userIdParam } from '@/modules/users/route-helpers';


export const handleGet = withHandler<{ user_id: string }>(async (_req, _ctx, route) => {
  const obj = await readAvatar(getProductDatabase(), await userIdParam(route));
  if (!obj) throw new ProductError(404, 'RES_AVATAR_NOT_FOUND', 'Avatar not found');
  return new Response(obj.body, {
    headers: { 'content-type': obj.contentType, 'content-length': String(obj.size), 'content-disposition': 'inline' },
  });
});
