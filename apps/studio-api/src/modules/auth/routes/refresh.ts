import { getAuthEnv } from '@/config/env';
import { refreshAccessToken } from '@/modules/auth/auth.service';
import { refreshSchema } from '@/modules/auth/auth.schemas';
import { readRequestCookie, setAuthCookiesOn } from '@/modules/auth/cookies';
import { ProductError } from '@/http/errors';
import { readJsonBody } from '@/http/body';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';


// Body `refresh_token` (contract) wins; browser flow falls back to the refresh cookie.
// No rotation: the existing refresh cookie is left untouched; only the access cookie is set.
export const handlePost = withHandler(async (req, ctx) => {
  const body = refreshSchema.parse(await readJsonBody(req, { optional: true }));
  const token = body?.refresh_token ?? readRequestCookie(req, getAuthEnv().AUTH_COOKIE_REFRESH);
  if (!token) {
    throw new ProductError(401, 'AUTH_INVALID_TOKEN', 'You are not logged in or your session has expired. Please log in again.');
  }
  const data = await refreshAccessToken(token);
  return setAuthCookiesOn(success(data, ctx), { access: data.access_token });
});
