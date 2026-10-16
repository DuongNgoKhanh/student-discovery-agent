import { getAuthEnv } from '@/config/env';
import { accessTokenTtlSeconds, refreshTokenTtlSeconds } from '@/modules/auth/tokens';

// ---------------------------------------------------------------------------
// Product (/api/v1) cookie helpers: operate on the route's own Request/Response,
// without framework-specific cookie mutation or fetching the app itself.
// ---------------------------------------------------------------------------

function serialize(name: string, value: string, maxAge: number): string {
  const parts = [`${name}=${value}`, 'Path=/', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax'];
  if (maxAge === 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (getAuthEnv().NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

/** Set the access cookie (and refresh cookie when given) with Max-Age = token TTL. */
export function setAuthCookiesOn(res: Response, tokens: { access: string; refresh?: string }): Response {
  const env = getAuthEnv();
  res.headers.append('set-cookie', serialize(env.AUTH_COOKIE_ACCESS, tokens.access, accessTokenTtlSeconds()));
  if (tokens.refresh !== undefined) {
    res.headers.append('set-cookie', serialize(env.AUTH_COOKIE_REFRESH, tokens.refresh, refreshTokenTtlSeconds()));
  }
  return res;
}

/** Expire the selected auth cookies on the response. */
export function clearAuthCookiesOn(res: Response, which: ReadonlyArray<'access' | 'refresh'> = ['access', 'refresh']): Response {
  const env = getAuthEnv();
  for (const kind of which) {
    res.headers.append('set-cookie', serialize(kind === 'access' ? env.AUTH_COOKIE_ACCESS : env.AUTH_COOKIE_REFRESH, '', 0));
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
