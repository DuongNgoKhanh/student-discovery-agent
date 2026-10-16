import { createHash, timingSafeEqual } from 'node:crypto';
import { getAuthEnv } from '@/config/env';
import type { ProductDatabase } from '@/infrastructure/db/client';
import { ProductError } from '@/http/errors';
import { findUserByEmail, findUserById } from '@/modules/users/users.repository';
import { createUser } from '@/modules/users/users.service';
import { adminToPublic, toUserProfile, type UserProfile } from '@/modules/users/users.profile';
import type { UserRow } from '@/modules/users/users.types';
import type { AdminLoginInput, AdminTokenData, AuthData, LoginInput, RegisterInput, TokenRefreshData } from '@/modules/auth/auth.schemas';
import { readRequestCookie } from '@/modules/auth/cookies';
import { assertPasswordPolicy, hashPassword, verifyPassword } from '@/modules/auth/password';
import { accessTokenTtlSeconds, issueAccessToken, issueRefreshToken, verifyToken, type TokenClaims } from '@/modules/auth/tokens';

const invalidCredentials = () => new ProductError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials provided');
const invalidToken = () =>
  new ProductError(401, 'AUTH_INVALID_TOKEN', 'You are not logged in or your session has expired. Please log in again.');
const emailTaken = () => new ProductError(400, 'VAL_EMAIL_ALREADY_EXISTS', 'Email is already registered');

async function issueUserTokens(user: UserProfile): Promise<AuthData> {
  const sub = String(user.id);
  return {
    user,
    access_token: await issueAccessToken(sub),
    refresh_token: await issueRefreshToken(sub),
    token_type: 'bearer',
    expires_in: accessTokenTtlSeconds(),
  };
}

export async function register(db: ProductDatabase, input: RegisterInput): Promise<AuthData> {
  assertPasswordPolicy(input.password);
  if (await findUserByEmail(db, input.email)) throw emailTaken();
  const hashed_password = await hashPassword(input.password);
  const created = await createUser(db, {
    email: input.email,
    hashed_password,
    name: input.name ?? null,
    avatar_url: input.avatar_url ?? null,
    bio: input.bio ?? null,
    position: input.position ?? null,
  });
  return issueUserTokens(adminToPublic(created));
}

// Burn comparable Argon2 work for unknown emails so response time does not reveal accounts.
let dummyHash: Promise<string> | undefined;

export async function login(db: ProductDatabase, input: LoginInput): Promise<AuthData> {
  const user = await findUserByEmail(db, input.email);
  if (!user || !user.hashed_password) {
    await verifyPassword(input.password, await (dummyHash ??= hashPassword('Dummy-passw0rd!')));
    throw invalidCredentials();
  }
  if (!(await verifyPassword(input.password, user.hashed_password))) throw invalidCredentials();
  return issueUserTokens(toUserProfile(user));
}

/** Legacy semantics: no rotation, no DB lookup; a refresh token yields a fresh access token. */
export async function refreshAccessToken(refresh: string): Promise<TokenRefreshData> {
  const claims = await verifyToken(refresh, 'refresh');
  return { access_token: await issueAccessToken(claims.sub), token_type: 'bearer', expires_in: accessTokenTtlSeconds() };
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
  if (!token) throw invalidToken();
  return verifyToken(token, 'access');
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
 * Admin: missing/invalid/expired/non-access token -> 401 AUTH_INVALID_TOKEN; a valid access
 * token without `admin: true` and `sub: 'admin'` -> 403 AUTHZ_INSUFFICIENT_PERMISSION (legacy 403).
 */
export async function requireAdmin(req: Request): Promise<{ sub: 'admin'; admin: true }> {
  const claims = await requireAccessClaims(req);
  if (claims.admin !== true || claims.sub !== 'admin') {
    throw new ProductError(403, 'AUTHZ_INSUFFICIENT_PERMISSION', 'Admin access required');
  }
  return { sub: 'admin', admin: true };
}
