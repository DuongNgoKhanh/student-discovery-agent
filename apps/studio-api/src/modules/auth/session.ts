import { getAuthEnv } from '@/config/env';
import { ProductError } from '@/http/errors';
import { z } from 'zod';
import { createSessionSchema, type Session } from '../../../../../contracts/runtime/session';
import type { TokenClaims } from './tokens';
import { requireAccessClaims } from './auth.service';

export type { Session };
const schema = createSessionSchema(z);

/** Read-only session metadata. Resource endpoints still enforce their own access checks. */
export async function getSessionFromRequest(req: Request): Promise<Session | null> {
  // A missing signing key is a server configuration failure, not an expired session.
  getAuthEnv();
  try {
    const claims = await requireAccessClaims(req);
    return sessionMetadata(claims);
  } catch (error) {
    if (error instanceof ProductError && error.status === 401) return null;
    throw error;
  }
}

export function sessionMetadata(claims: TokenClaims): Session {
  const admin = claims.admin === true && claims.sub === 'admin';
  try {
    return schema.parse({ principal: { type: admin ? 'admin' : 'user', id: claims.sub }, is_admin: admin });
  } catch {
    throw new ProductError(401, 'AUTH_INVALID_TOKEN', 'Invalid session principal');
  }
}
