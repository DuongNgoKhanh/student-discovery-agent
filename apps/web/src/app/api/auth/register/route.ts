import { NextResponse } from 'next/server';
import { getServerEnv } from '@/config/env';
import { unwrap } from '@/lib/api/response';
import { setAuthCookies } from '@/server/auth/cookies';
import { ApiError } from '@/lib/api/errors';

export async function POST(req: Request) {
  const env = getServerEnv();
  const payload = await req.json();
  try {
    const upstream = await fetch(`${env.API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await unwrap<{ access_token: string; refresh_token: string }>(upstream);
    await setAuthCookies({ access: data.access_token, refresh: data.refresh_token });
    return NextResponse.json({ success: true, data: { ok: true } });
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: { code: e.code, message: e.message, retryable: e.retryable } },
        { status: e.httpStatus >= 500 ? 502 : e.httpStatus },
      );
    }
    return NextResponse.json(
      { success: false, error: { code: 'SYS_500', message: 'Lỗi kết nối máy chủ.' } },
      { status: 502 },
    );
  }
}
