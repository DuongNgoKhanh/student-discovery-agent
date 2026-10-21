import { getAuthEnv } from '@/config/env';
import { refreshAccessToken } from '@/modules/auth/auth.service';
import { refreshSchema } from '@/modules/auth/auth.schemas';
import { readRequestCookie, setAuthCookiesOn } from '@/modules/auth/cookies';
import { getProductDatabase } from '@/infrastructure/db/client';
import { requireSameOrigin } from '../csrf';
import { ProductError } from '@/http/errors';
import { readJsonBody } from '@/http/body';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';
export const handlePost = withHandler(async (req, ctx) => {
  requireSameOrigin(req);
  refreshSchema.parse(await readJsonBody(req, { optional: true }));
  const token = readRequestCookie(req, getAuthEnv().AUTH_COOKIE_REFRESH);
  if (!token) throw new ProductError(401, 'AUTH_TOKEN_MISSING', 'Refresh cookie is required');
  const result = await refreshAccessToken(getProductDatabase(), token);
  return setAuthCookiesOn(success(result.data, ctx), {
    access: result.data.access_token, refresh: result.refresh_token, sessionMaxAge: result.session_max_age,
  });
});
