import 'server-only';
import { cookies } from 'next/headers';
import { getServerEnv } from '@/config/env';

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
