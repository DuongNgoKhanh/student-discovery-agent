import { getAuthEnv } from '@/config/env';
import { accessTokenTtlSeconds, refreshTokenTtlSeconds } from '@/modules/auth/tokens';

// ---------------------------------------------------------------------------
// Product (/api/v1) cookie helpers: operate on the route's own Request/Response,
// without framework-specific cookie mutation or fetching the app itself.
// ---------------------------------------------------------------------------

function serialize(name: string, value: string, maxAge: number, path = '/'): string {
  const parts = [`${name}=${value}`, `Path=${path}`, `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax'];
  if (maxAge === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (getAuthEnv().NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

/** User access cookies retain expired JWTs until session expiry for refresh recovery; admin cookies use JWT TTL. */
export function setAuthCookiesOn(res: Response, tokens: { access: string; refresh?: string; sessionMaxAge?: number }): Response {
  const env = getAuthEnv();
  res.headers.append('set-cookie', serialize(env.AUTH_COOKIE_ACCESS, tokens.access, tokens.sessionMaxAge ?? accessTokenTtlSeconds()));
  if (tokens.refresh !== undefined) {
    // Remove the pre-migration root-scoped refresh cookie before setting the narrow one.
    res.headers.append('set-cookie', serialize(env.AUTH_COOKIE_REFRESH, '', 0));
    res.headers.append('set-cookie', serialize(env.AUTH_COOKIE_REFRESH, tokens.refresh, tokens.sessionMaxAge ?? refreshTokenTtlSeconds(), '/api/v1/auth'));
  }
  return res;
}

/** Expire the selected auth cookies on the response. */
export function clearAuthCookiesOn(res: Response, which: ReadonlyArray<'access' | 'refresh'> = ['access', 'refresh']): Response {
  const env = getAuthEnv();
  for (const kind of which) {
    const name = kind === 'access' ? env.AUTH_COOKIE_ACCESS : env.AUTH_COOKIE_REFRESH;
    res.headers.append('set-cookie', serialize(name, '', 0));
    if (kind === 'refresh') res.headers.append('set-cookie', serialize(name, '', 0, '/api/v1/auth'));
  }
  return res;
}

/** Read a cookie from the incoming request's `Cookie` header. */
export function readRequestCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) {
      const value = part.slice(i + 1).trim();
      return value || undefined;
    }
  }
  return undefined;
}
