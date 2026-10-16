import { NextResponse } from 'next/server';
import { getServerEnv } from '@/config/env';
import { unwrap } from '@/lib/api/response';
import { setAuthCookies, clearAuthCookies, readRefreshCookie } from '@/server/auth/cookies';

export async function POST() {
  const env = getServerEnv();
  const refresh = await readRefreshCookie();
  if (!refresh) {
    await clearAuthCookies();
    return NextResponse.json(
      { success: false, error: { code: 'AUTH_401', message: 'Chưa đăng nhập.' } },
      { status: 401 },
    );
  }
  try {
    const upstream = await fetch(`${env.API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    const data = await unwrap<{ access_token: string; refresh_token?: string }>(upstream);
    await setAuthCookies({ access: data.access_token, refresh: data.refresh_token ?? refresh });
    return NextResponse.json({ success: true, data: { ok: true } });
  } catch {
    await clearAuthCookies();
    return NextResponse.json(
      { success: false, error: { code: 'AUTH_401', message: 'Phiên hết hạn.' } },
      { status: 401 },
    );
  }
}
