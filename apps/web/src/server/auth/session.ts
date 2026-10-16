import 'server-only';
import { cookies } from 'next/headers';
import { getAuthEnv } from '@/config/env';
import { verifyToken } from './tokens';

export interface Session {
  userId: string;
  isAdmin: boolean;
}

/**
 * Session for Server Components / layouts: reads the access cookie and VERIFIES it
 * (HS256 signature, exp, type=access). Decode-only is never trusted for authorization.
 * Does not hit the DB; routes that act on a user must still call `requireUser`.
 */
export async function getSession(): Promise<Session | null> {
  const env = getAuthEnv();
  const token = (await cookies()).get(env.AUTH_COOKIE_ACCESS)?.value;
  if (!token) return null;
  try {
    const claims = await verifyToken(token, 'access');
    return { userId: claims.sub, isAdmin: claims.admin === true && claims.sub === 'admin' };
  } catch {
    return null;
  }
}
