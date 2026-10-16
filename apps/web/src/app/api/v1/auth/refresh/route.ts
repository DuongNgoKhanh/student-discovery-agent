import { getAuthEnv } from '@/config/env';
import { refreshAccessToken } from '@/server/auth/auth.service';
import { refreshSchema } from '@/server/auth/auth.schemas';
import { readRequestCookie, setAuthCookiesOn } from '@/server/auth/cookies';
import { ProductError } from '@/server/http/errors';
import { readJsonBody } from '@/server/http/body';
import { withHandler } from '@/server/http/handler';
import { success } from '@/server/http/response';

export const runtime = 'nodejs';

// Body `refresh_token` (contract) wins; browser flow falls back to the refresh cookie.
// No rotation: the existing refresh cookie is left untouched; only the access cookie is set.
export const POST = withHandler(async (req, ctx) => {
  const body = refreshSchema.parse(await readJsonBody(req, { optional: true }));
  const token = body?.refresh_token ?? readRequestCookie(req, getAuthEnv().AUTH_COOKIE_REFRESH);
  if (!token) {
    throw new ProductError(401, 'AUTH_INVALID_TOKEN', 'You are not logged in or your session has expired. Please log in again.');
  }
  const data = await refreshAccessToken(token);
  return setAuthCookiesOn(success(data, ctx), { access: data.access_token });
});
