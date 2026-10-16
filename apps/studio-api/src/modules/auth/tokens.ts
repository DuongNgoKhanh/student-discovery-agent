import { jwtVerify, SignJWT } from 'jose';
import { getAuthEnv } from '@/config/env';
import { ProductError } from '@/http/errors';

export type TokenType = 'access' | 'refresh';

export interface TokenClaims {
  sub: string;
  type: TokenType;
  admin?: boolean;
  exp: number;
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
 * Claims are exactly the legacy ones (`sub`, `exp`, `type`, plus `admin` for admin tokens);
 * no iat/iss/aud so tokens stay interchangeable with the Python service.
 */
async function sign(claims: Record<string, unknown>, ttlSeconds: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return new SignJWT({ ...claims, exp }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(signingKey());
}

export async function issueAccessToken(subject: string, isAdmin = false): Promise<string> {
  const claims: Record<string, unknown> = isAdmin ? { sub: subject, admin: true } : { sub: subject };
  return sign({ ...claims, type: 'access' }, accessTokenTtlSeconds());
}

export async function issueRefreshToken(subject: string): Promise<string> {
  return sign({ sub: subject, type: 'refresh' }, refreshTokenTtlSeconds());
}

const invalidToken = () =>
  new ProductError(401, 'AUTH_INVALID_TOKEN', 'You are not logged in or your session has expired. Please log in again.');

/**
 * Verify an HS256 token (signature + exp) and its `type`. Throws `ProductError` 401
 * `AUTH_INVALID_TOKEN` on any failure. Algorithm is pinned to HS256 (no `none`, no HS384/512).
 */
export async function verifyToken(token: string, expectedType: TokenType): Promise<TokenClaims> {
  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, signingKey(), { algorithms: ['HS256'], requiredClaims: ['exp', 'sub'] }));
  } catch {
    throw invalidToken();
  }
  const { sub, type, exp, admin } = payload;
  if (typeof sub !== 'string' || !sub || typeof exp !== 'number' || type !== expectedType) throw invalidToken();
  const claims: TokenClaims = { sub, type: expectedType, exp };
  if (admin !== undefined) claims.admin = admin === true;
  return claims;
}
