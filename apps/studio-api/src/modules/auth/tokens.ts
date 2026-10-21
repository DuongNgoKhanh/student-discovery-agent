import { errors, jwtVerify, SignJWT } from 'jose';
import { getAuthEnv } from '@/config/env';
import { ProductError } from '@/http/errors';

export type TokenType = 'access' | 'refresh';

export interface TokenClaims {
  sub: string;
  type: TokenType;
  admin?: boolean;
  exp: number;
  sid?: string;
}

/** PyJWT used `settings.SECRET_KEY` as raw UTF-8 bytes (never base64-decoded). */
function signingKey(): Uint8Array {
  return new TextEncoder().encode(getAuthEnv().SECRET_KEY);
}

export function accessTokenTtlSeconds(): number {
  return getAuthEnv().ACCESS_TOKEN_EXPIRE_MINUTES * 60;
}

export function refreshTokenTtlSeconds(): number {
  return getAuthEnv().REFRESH_TOKEN_EXPIRE_MINUTES * 60;
}

/**
 * Access tokens carry contract version2 so old multi-day access credentials cannot bypass
 * the shorter lifetime after deployment. Refresh HTTP credentials are opaque DB-backed values.
 */
async function sign(claims: Record<string, unknown>, ttlSeconds: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return new SignJWT({ ...claims, exp }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(signingKey());
}

export async function issueAccessToken(subject: string, isAdmin = false, sessionId?: string): Promise<string> {
  const claims: Record<string, unknown> = isAdmin ? { sub: subject, admin: true } : { sub: subject };
  return sign({ ...claims, ...(sessionId ? { sid: sessionId } : {}), type: 'access', ver: 2 }, accessTokenTtlSeconds());
}

export async function issueRefreshToken(subject: string): Promise<string> {
  return sign({ sub: subject, type: 'refresh' }, refreshTokenTtlSeconds());
}

const invalidToken = () =>
  new ProductError(401, 'AUTH_INVALID_TOKEN', 'You are not logged in or your session has expired. Please log in again.');

/**
 * Verify an HS256 token (signature + exp) and its `type`. Throws `ProductError` 401
 * `AUTH_TOKEN_EXPIRED` on expiry and `AUTH_INVALID_TOKEN` on other failures. Algorithm is pinned to HS256 (no `none`, no HS384/512).
 */
export async function verifyToken(token: string, expectedType: TokenType): Promise<TokenClaims> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'], requiredClaims: ['exp', 'sub'] }));
  } catch (error) {
    if (error instanceof errors.JWTExpired) throw new ProductError(401, 'AUTH_TOKEN_EXPIRED', 'Access token has expired');
    throw invalidToken();
  }
  const { sub, type, exp, admin, sid, ver } = payload;
  if (expectedType === 'access' && ver !== 2) throw invalidToken();
  if (typeof sub !== 'string' || !sub || typeof exp !== 'number' || type !== expectedType) throw invalidToken();
  const claims: TokenClaims = { sub, type: expectedType, exp };
  if (admin !== undefined) claims.admin = admin === true;
  if (sid !== undefined) {
    if (typeof sid !== 'string' || !/^[0-9a-f-]{36}$/i.test(sid)) throw invalidToken();
    claims.sid = sid;
  }
  return claims;
}
