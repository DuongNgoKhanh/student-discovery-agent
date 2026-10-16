import { getAuthEnv } from '@/config/env';
import { ProductError } from '@/http/errors';
import type { components } from '@/generated/api/user-api';
import { requireAccessClaims } from './auth.service';

export type Session = components['schemas']['SessionMetadata'];

/** Read-only session metadata. Resource endpoints still enforce their own access checks. */
export async function getSessionFromRequest(req: Request): Promise<Session | null> {
  // A missing signing key is a server configuration failure, not an expired session.
  getAuthEnv();
  try {
    const claims = await requireAccessClaims(req);
    return { userId: claims.sub, isAdmin: claims.admin === true && claims.sub === 'admin' };
  } catch (error) {
    if (error instanceof ProductError && error.status === 401) return null;
    throw error;
  }
}
