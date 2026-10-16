import 'server-only';
import { decodeJwt, isExpired } from '@/lib/auth/jwt-decode';
import { readAccessCookie } from './cookies';

export interface Session {
  userId: string;
  isAdmin: boolean;
}

/** Đọc session từ access cookie (dùng trong Server Component / route handler). */
export async function getSession(): Promise<Session | null> {
  const token = await readAccessCookie();
  if (!token) return null;
  const payload = decodeJwt(token);
  if (!payload?.sub || isExpired(payload)) return null;
  return { userId: payload.sub, isAdmin: payload.admin === true };
}
