import { NextRequest, NextResponse } from 'next/server';
import { getServerEnv } from '@/config/env';
import {
  readAccessCookie,
  readRefreshCookie,
  setAuthCookies,
  clearAuthCookies,
} from '@/server/auth/cookies';
import { refreshAccessToken } from '@/server/auth/refresh';

/**
 * BFF proxy: browser gọi /api/bff/<path khớp FastAPI>.
 * Gắn Bearer từ httpOnly cookie, khi upstream trả 401 thì refresh 1 lần,
 * xoay cookie rồi retry. Trả nguyên envelope của backend (client tự unwrap).
 */
async function forward(
  req: NextRequest,
  path: string,
  token: string | undefined,
): Promise<Response> {
  const env = getServerEnv();
  const url = `${env.API_BASE_URL}/${path}${req.nextUrl.search}`;
  const headers = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  if (token) headers.set('authorization', `Bearer ${token}`);
  const method = req.method;
  const body = method === 'GET' || method === 'HEAD' ? undefined : await req.text();
  return fetch(url, { method, headers, body, cache: 'no-store' });
}

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const joined = path.join('/');
  const access = await readAccessCookie();

  let upstream = await forward(req, joined, access);

  if (upstream.status === 401) {
    const refresh = await readRefreshCookie();
    const rotated = refresh ? await refreshAccessToken(refresh) : null;
    if (!rotated) {
      await clearAuthCookies();
      return NextResponse.json(
        { success: false, error: { code: 'AUTH_401', message: 'Phiên hết hạn.' } },
        { status: 401 },
      );
    }
    await setAuthCookies(rotated);
    upstream = await forward(req, joined, rotated.access);
  }

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
