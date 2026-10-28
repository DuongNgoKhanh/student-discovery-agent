import { NextRequest, NextResponse } from 'next/server';
import { decodeJwt, isExpired } from '@/lib/auth/jwt-decode';
import { safeNext } from '@/lib/auth/safe-next';

// Middleware chạy ở edge runtime: chỉ import code thuần (không next/headers).
// Đây chỉ là cổng UX (decode-only); studio-api xác thực thật qua API session và resource.
const ACCESS = process.env.AUTH_COOKIE_ACCESS ?? 'sda_access';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(ACCESS)?.value;
  const payload = token ? decodeJwt(token) : null;
  const authed = !!payload?.sub && !isExpired(payload);
  const isAdmin = authed && payload?.admin === true;

  // Admin đã đăng nhập không cần thấy lại form.
  if (pathname === '/admin/login') {
    if (!isAdmin) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = '/admin/agent';
    url.search = '';
    return NextResponse.redirect(url);
  }

  const isAdminArea = pathname === '/admin' || pathname.startsWith('/admin/');

  // Admin luôn về admin login (không dùng refresh user); giữ trang đích để quay lại sau khi đăng nhập.
  if (isAdminArea && !isAdmin) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin/login';
    url.search = '';
    if (pathname !== '/admin') url.searchParams.set('next', safeNext(pathname, '/admin'));
    return NextResponse.redirect(url);
  }

  // Missing credentials → /login, giữ đích đến qua ?next= (đã sanitize)
  if (!isAdminArea && !authed && !(payload?.sub && payload.type === 'access' && payload.admin !== true)) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', safeNext(pathname));
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
};
