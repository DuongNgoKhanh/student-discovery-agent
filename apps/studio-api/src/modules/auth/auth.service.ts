import { createHash, timingSafeEqual } from 'node:crypto';
import { getAuthEnv } from '@/config/env';
import { getProductDatabase, type ProductDatabase } from '@/infrastructure/db/client';
import { assertActiveSession, createRefreshSession, rotateRefreshSession } from './refresh-sessions';
import { ProductError } from '@/http/errors';
import { findUserByEmail, findUserById } from '@/modules/users/users.repository';
import { createUser } from '@/modules/users/users.service';
import { adminToSelf, toUserProfile, type UserProfile } from '@/modules/users/users.profile';
import type { UserRow } from '@/modules/users/users.types';
import type { AdminLoginInput, AdminTokenData, AuthData, LoginInput, RegisterInput, TokenRefreshData } from '@/modules/auth/auth.schemas';
import { readRequestCookie } from '@/modules/auth/cookies';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '@/modules/auth/password';
import { accessTokenTtlSeconds, issueAccessToken, verifyToken, type TokenClaims } from '@/modules/auth/tokens';

const invalidCredentials = () => new ProductError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials provided');
const invalidToken = () =>
  new ProductError(401, 'AUTH_INVALID_TOKEN', 'You are not logged in or your session has expired. Please log in again.');
const emailTaken = () => new ProductError(409, 'CONFLICT_EMAIL_EXISTS', 'Email is already registered');

export interface UserAuthResult { data: AuthData; refresh_token: string; session_max_age: number }
async function issueUserTokens(db: ProductDatabase, user: UserProfile): Promise<UserAuthResult> {
  const session = await createRefreshSession(db, user.id);
  return {
    data: { user, access_token: await issueAccessToken(String(user.id), false, session.session_id),
      token_type: 'bearer', expires_in: accessTokenTtlSeconds() },
    refresh_token: session.token, session_max_age: session.max_age,
  };
}

export async function register(db: ProductDatabase, input: RegisterInput): Promise<UserAuthResult> {
  assertPasswordPolicy(input.password);
  if (await findUserByEmail(db, input.email)) throw emailTaken();
  const hashed_password = await hashPassword(input.password);
  let created;
  try { created = await createUser(db, {
    email: input.email,
    hashed_password,
    name: input.name ?? null,
    avatar_url: input.avatar_url ?? null,
    bio: input.bio ?? null,
    position: input.position ?? null,
  });
  } catch (error) {
    if (error instanceof ProductError && error.code === 'VAL_EMAIL_ALREADY_EXISTS') throw emailTaken();
    throw error;
  }
  return issueUserTokens(db, adminToSelf(created));
}

// Burn comparable Argon2 work for unknown emails so response time does not reveal accounts.
let dummyHash: Promise<string> | undefined;

export async function login(db: ProductDatabase, input: LoginInput): Promise<UserAuthResult> {
  const user = await findUserByEmail(db, input.email);
  if (!user || !user.hashed_password) {
    await verifyPassword(input.password, await (dummyHash ??= hashPassword('Dummy-passw0rd!')));
    throw invalidCredentials();
  }
  if (!(await verifyPassword(input.password, user.hashed_password))) throw invalidCredentials();
  return issueUserTokens(db, toUserProfile(user));
}

export async function refreshAccessToken(db: ProductDatabase, refresh: string): Promise<{
  data: TokenRefreshData; refresh_token: string; session_max_age: number;
}> {
  const session = await rotateRefreshSession(db, refresh);
  return { data: { access_token: await issueAccessToken(String(session.user_id), false, session.session_id),
    token_type: 'bearer', expires_in: accessTokenTtlSeconds() },
    refresh_token: session.token, session_max_age: session.max_age };
}

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
let warnedMissingAdminPassword = false;

/**
 * Credentials come from ADMIN_USERNAME / ADMIN_PASSWORD (read per call). There is no default
 * password: when ADMIN_PASSWORD is unset/empty every admin login fails with 401.
 */
export async function adminLogin(input: AdminLoginInput): Promise<AdminTokenData> {
  const env = getAuthEnv();
  if (!env.ADMIN_PASSWORD) {
    if (!warnedMissingAdminPassword) {
      warnedMissingAdminPassword = true;
      console.warn('[auth] ADMIN_PASSWORD is not set; admin login is disabled.');
    }
    throw invalidCredentials();
  }
  // Fixed-length digests make timingSafeEqual length-independent; evaluate both, no short-circuit.
  const userOk = timingSafeEqual(digest(input.username), digest(env.ADMIN_USERNAME));
  const passOk = timingSafeEqual(digest(input.password), digest(env.ADMIN_PASSWORD));
  if (!(userOk && passOk)) throw invalidCredentials();
  return { access_token: await issueAccessToken('admin', true), token_type: 'bearer', expires_in: accessTokenTtlSeconds() };
}

/**
 * Token source: an `Authorization` header, if present, is authoritative and must be
 * `Bearer <token>`; an invalid one never falls back to the cookie. Otherwise the access cookie.
 */
function extractToken(req: Request): string | undefined {
  const header = req.headers.get('authorization');
  if (header !== null) {
    const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
    if (!match) throw invalidToken();
    return match[1];
  }
  return readRequestCookie(req, getAuthEnv().AUTH_COOKIE_ACCESS);
}

export async function requireAccessClaims(req: Request): Promise<TokenClaims> {
  const token = extractToken(req);
  if (!token) throw new ProductError(401, 'AUTH_TOKEN_MISSING', 'Access token is required');
  const claims = await verifyToken(token, 'access');
  if (claims.sid) await assertActiveSession(getProductDatabase(), claims.sid, claims.sub);
  return claims;
}

/** Current user: valid access token with numeric `sub` of an existing, non-deleted user; else 401. */
export async function requireUser(req: Request, db: ProductDatabase): Promise<UserRow> {
  const claims = await requireAccessClaims(req);
  if (!/^[1-9]\d{0,9}$/.test(claims.sub)) throw invalidToken();
  const id = Number(claims.sub);
  if (id > 2_147_483_647) throw invalidToken();
  const user = await findUserById(db, id);
  if (!user) throw invalidToken();
  return user;
}

/**
 * Admin: missing, invalid and expired tokens retain their distinct 401 codes; a valid access
 * token without `admin: true` and `sub: 'admin'` -> 403 AUTHZ_INSUFFICIENT_PERMISSION (legacy 403).
 */
export async function requireAdmin(req: Request): Promise<{ sub: 'admin'; admin: true }> {
  const claims = await requireAccessClaims(req);
  if (claims.admin !== true || claims.sub !== 'admin') {
    throw new ProductError(403, 'AUTHZ_INSUFFICIENT_PERMISSION', 'Admin access required');
  }
  return { sub: 'admin', admin: true };
}
