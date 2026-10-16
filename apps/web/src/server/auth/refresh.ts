import 'server-only';
import { getServerEnv } from '@/config/env';

/**
 * Gọi thẳng endpoint refresh của backend, trả cặp token mới hoặc null.
 * Dùng bởi BFF proxy khi upstream trả 401.
 */
export async function refreshAccessToken(
  refresh: string,
): Promise<{ access: string; refresh: string } | null> {
  const env = getServerEnv();
  const res = await fetch(`${env.API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  if (!body?.success) return null;
  const data = body.data;
  if (!data?.access_token) return null;
  return { access: data.access_token, refresh: data.refresh_token ?? refresh };
}
