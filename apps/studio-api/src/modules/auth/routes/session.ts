import { withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { sessionMetadata } from '../session';
import { requireAccessClaims } from '../auth.service';

export const handleGet = withHandler(async (req, ctx) => {
  const claims = await requireAccessClaims(req);
  const session = sessionMetadata(claims);
  return success(session, ctx);
});
