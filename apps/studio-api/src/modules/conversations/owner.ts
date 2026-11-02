import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAuthEnv, getConversationEnv } from '@/config/env';
import { readRequestCookie } from '@/modules/auth/cookies';

// Anonymous student owner (SRS M-AUTH, ADR-001): an opaque id bound to an HMAC so the browser cannot pick
// another owner. Credential format/TTL are still pending DEC-07; this is the local scaffold, not the final format.
export const OWNER_COOKIE = 'sda_owner';
const OWNER_ID = /^own_[0-9a-f]{32}$/;

function mac(ownerId: string): string {
  return createHmac('sha256', getConversationEnv().SECRET_KEY).update(`sda_owner:v1:${ownerId}`).digest('base64url');
}

export function newOwnerId(): string {
  return `own_${randomBytes(16).toString('hex')}`;
}

export function ownerCookieValue(ownerId: string): string {
  return `${ownerId}.${mac(ownerId)}`;
}

/** Owner id from a valid cookie; undefined when absent, malformed or not signed by us. */
export function readOwner(req: Request): string | undefined {
  const value = readRequestCookie(req, OWNER_COOKIE);
  const dot = value?.indexOf('.') ?? -1;
  if (!value || dot < 0) return undefined;
  const ownerId = value.slice(0, dot);
  if (!OWNER_ID.test(ownerId)) return undefined;
  const given = Buffer.from(value.slice(dot + 1));
  const expected = Buffer.from(mac(ownerId));
  return given.length === expected.length && timingSafeEqual(given, expected) ? ownerId : undefined;
}

/** HttpOnly, host-only, Path=/api/v1, SameSite=Lax; Secure in production (contract user-api.yaml). */
export function setOwnerCookieOn(res: Response, ownerId: string): Response {
  const parts = [`${OWNER_COOKIE}=${ownerCookieValue(ownerId)}`, 'Path=/api/v1',
    `Max-Age=${getConversationEnv().OWNER_COOKIE_MAX_AGE_SECONDS}`, 'HttpOnly', 'SameSite=Lax'];
  if (getAuthEnv().NODE_ENV === 'production') parts.push('Secure');
  res.headers.append('set-cookie', parts.join('; '));
  return res;
}
