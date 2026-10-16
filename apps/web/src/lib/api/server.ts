import { getServerEnv } from '@/config/env';
import { readAccessCookie } from '@/server/auth/cookies';
import { unwrap } from './response';

/**
 * Fetch dùng trong Server Component / route handler: đọc access cookie,
 * gọi FastAPI trực tiếp, unwrap envelope. Không cache (dữ liệu theo user).
 */
export async function serverFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const env = getServerEnv();
  const token = await readAccessCookie();
  const headers = new Headers(init?.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  const res = await fetch(`${env.API_BASE_URL}/${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  return unwrap<T>(res);
}
