import { ProductError } from '@/http/errors';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { getSessionFromRequest } from '../session';

export const handleGet = withHandler(async (req, ctx) => {
  const session = await getSessionFromRequest(req);
  if (!session) throw new ProductError(401, 'AUTH_INVALID_TOKEN', 'Invalid or expired session');
  return success(session, ctx);
});
