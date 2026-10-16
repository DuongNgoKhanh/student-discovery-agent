import { NextRequest, NextResponse } from 'next/server';
import { decodeJwt, isExpired } from '@/lib/auth/jwt-decode';
import { safeNext } from '@/lib/auth/safe-next';

// Middleware chạy ở edge runtime: chỉ import code thuần (không next/headers).
// Đây chỉ là cổng UX (decode-only); studio-api xác thực thật qua API session và resource.
const ACCESS = process.env.AUTH_COOKIE_ACCESS ?? 'sda_access';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/admin/login') return NextResponse.next();

  const token = req.cookies.get(ACCESS)?.value;
  const payload = token ? decodeJwt(token) : null;
  const authed = !!payload?.sub && !isExpired(payload);
  const isAdminArea = pathname === '/admin' || pathname.startsWith('/admin/');

  // Admin luôn về admin login (không dùng refresh user).
  if (isAdminArea && !(authed && payload?.admin === true)) {
    const url = req.nextUrl.clone();
    url.pathname = '/admin/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // Chưa đăng nhập / access hết hạn → /login, giữ đích đến qua ?next= (đã sanitize)
  if (!isAdminArea && !authed) {
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
