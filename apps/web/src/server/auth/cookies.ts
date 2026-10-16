import 'server-only';
import { cookies } from 'next/headers';
import { getAuthEnv, getServerEnv } from '@/config/env';
import { accessTokenTtlSeconds, refreshTokenTtlSeconds } from './tokens';

const base = { httpOnly: true, sameSite: 'lax' as const, path: '/' };

export async function setAuthCookies(tokens: { access: string; refresh: string }): Promise<void> {
  const env = getServerEnv();
  const secure = env.NODE_ENV === 'production';
  const store = await cookies();
  store.set(env.AUTH_COOKIE_ACCESS, tokens.access, { ...base, secure });
  store.set(env.AUTH_COOKIE_REFRESH, tokens.refresh, { ...base, secure });
}

export async function clearAuthCookies(): Promise<void> {
  const env = getServerEnv();
  const store = await cookies();
  store.delete(env.AUTH_COOKIE_ACCESS);
  store.delete(env.AUTH_COOKIE_REFRESH);
}

export async function readAccessCookie(): Promise<string | undefined> {
  const env = getServerEnv();
  return (await cookies()).get(env.AUTH_COOKIE_ACCESS)?.value;
}

export async function readRefreshCookie(): Promise<string | undefined> {
  const env = getServerEnv();
  return (await cookies()).get(env.AUTH_COOKIE_REFRESH)?.value;
}

// ---------------------------------------------------------------------------
// Product (/api/v1) cookie helpers: operate on the route's own Request/Response,
// never via next/headers mutation or by fetching the app itself.
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
