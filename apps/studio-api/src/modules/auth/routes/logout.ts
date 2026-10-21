import { getAuthEnv } from '@/config/env';
import { getProductDatabase } from '@/infrastructure/db/client';
import { clearAuthCookiesOn, readRequestCookie } from '@/modules/auth/cookies';
import { ProductError } from '@/http/errors';
import { requireAccessClaims } from '../auth.service';
import { revokeAccessSession, revokeRefreshSession } from '../refresh-sessions';
import { requireSameOrigin } from '../csrf';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';
export const handlePost = withHandler(async (req, ctx) => {
  requireSameOrigin(req);
  const token = readRequestCookie(req, getAuthEnv().AUTH_COOKIE_REFRESH);
  if (token) await revokeRefreshSession(getProductDatabase(), token);
  // Support access-only callers as well. Missing/invalid/expired access does not
  // make logout fail; only a currently verified sid may revoke this fallback family.
  try {
    const claims = await requireAccessClaims(req);
    if (claims.sid) await revokeAccessSession(getProductDatabase(), claims.sid, claims.sub);
  } catch (error) {
    if (!(error instanceof ProductError && error.status === 401)) throw error;
  }
  return clearAuthCookiesOn(success({ ok: true as const }, ctx));
});
