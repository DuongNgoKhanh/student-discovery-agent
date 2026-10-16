import { NextRequest, NextResponse } from 'next/server';
import { decodeJwt, isExpired } from '@/lib/auth/jwt-decode';

// Middleware chạy ở edge runtime: chỉ import code thuần (không next/headers).
const ACCESS = process.env.AUTH_COOKIE_ACCESS ?? 'sda_access';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(ACCESS)?.value;
  const payload = token ? decodeJwt(token) : null;
  const authed = !!payload?.sub && !isExpired(payload);

  const isAdminArea = pathname.startsWith('/admin');
  const isProtected = isAdminArea || pathname.startsWith('/dashboard');

  // Chưa đăng nhập → về /login, giữ lại đích đến qua ?next=
  if (isProtected && !authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Vào khu admin nhưng không phải admin → đẩy về dashboard
  if (isAdminArea && payload?.admin !== true) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*'],
};
