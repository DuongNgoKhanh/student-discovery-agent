import { sql } from 'drizzle-orm';
import { dispatch } from '../helpers/api';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import { parse } from 'yaml';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import legacy from '../fixtures/legacy/auth.json';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { closeProductDatabase, getProductDatabase } from '@/infrastructure/db/client';
import { findUserByEmail, insertUser, updateUserRow } from '@/modules/users/users.repository';
import { issueAccessToken, issueRefreshToken, verifyToken } from '@/modules/auth/tokens';
import { requireAdmin, requireUser } from '@/modules/auth/auth.service';

const SECRET = 'integration-test-secret';
const ADMIN_PASSWORD = 'Adm1n!integration';
const ACCESS_TTL = 1800;
const REFRESH_TTL = 1209600;
const STRONG = 'Str0ng!Pass';

// Envelope check against contracts/openapi/schemas/common.yaml ApiResponse.
const common = parse(readFileSync(resolve(__dirname, '../../../../contracts/openapi/schemas/common.yaml'), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addFormat('date-time', true);
ajv.addSchema({ $id: 'error-codes.yaml', ...parse(readFileSync(resolve(__dirname, '../../../../contracts/openapi/schemas/error-codes.yaml'), 'utf8')) });
ajv.addSchema({ $id: 'common', components: common.components });
const validateEnvelope = ajv.compile({ $ref: 'common#/components/schemas/ApiResponse' });

let pg: PostgresHandle;

beforeAll(async () => {
  pg = await startPostgres();
  await migrateProduct(pg.url);
});
afterAll(async () => {
  try {
    await closeProductDatabase();
  } finally {
    await pg?.stop();
  }
});
beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv('DATABASE_URL', pg.url);
  vi.stubEnv('SECRET_KEY', SECRET);
  vi.stubEnv('ADMIN_USERNAME', 'root');
  vi.stubEnv('ADMIN_PASSWORD', ADMIN_PASSWORD);
  await getProductDatabase().execute(sql`TRUNCATE product.auth_registration_limits`);
});

function post(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/v1${path}`, {
    method: 'POST',
    headers: body === undefined ? { origin: 'http://localhost', ...headers } : { origin: 'http://localhost', 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}
function req(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/v1/anything', { headers });
}
async function json(res: Response) {
  const body = await res.json();
  expect(validateEnvelope(body), JSON.stringify(validateEnvelope.errors)).toBe(true);
  return body;
}
interface SetCookie {
  value: string;
  attrs: Record<string, string | true>;
}
function setCookies(res: Response): Record<string, SetCookie> {
  const out: Record<string, SetCookie> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...rest] = line.split(';').map((s) => s.trim());
    const eq = pair!.indexOf('=');
    const attrs: Record<string, string | true> = {};
    for (const a of rest) {
      const i = a.indexOf('=');
      if (i === -1) attrs[a.toLowerCase()] = true;
      else attrs[a.slice(0, i).toLowerCase()] = a.slice(i + 1);
    }
    out[pair!.slice(0, eq)] = { value: pair!.slice(eq + 1), attrs };
  }
  return out;
}
function expectAuthCookie(c: SetCookie | undefined, maxAge: number, path = '/') {
  expect(c).toBeDefined();
  expect(c!.attrs.httponly).toBe(true);
  expect(String(c!.attrs.samesite).toLowerCase()).toBe('lax');
  expect(c!.attrs.path).toBe(path);
  expect(c!.attrs['max-age']).toBe(String(maxAge));
}
function expectDeleted(c: SetCookie | undefined, path = '/') {
  expect(c).toBeDefined();
  expect(c!.value).toBe('');
  expect(c!.attrs['max-age']).toBe('0');
  expect(c!.attrs.path).toBe(path);
}
let seq = 0;
const email = () => `user${++seq}-${Date.now()}@example.test`;


describe('POST /auth/register', () => {
  it('returns flat tokens + user, sets both cookies and stores an Argon2id hash', async () => {
    const addr = email();
    const res = await register(post('/auth/register', { email: addr, password: STRONG, name: 'Reg' }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.data).not.toHaveProperty('token');
    expect(body.data).toMatchObject({ token_type: 'bearer', expires_in: ACCESS_TTL, user: { email: addr, name: 'Reg' } });
    expect(body.data.user).not.toHaveProperty('hashed_password');
    expect(typeof body.data.user.id).toBe('number');
    expect(await verifyToken(body.data.access_token, 'access')).toMatchObject({ sub: String(body.data.user.id) });
    expect(body.data).not.toHaveProperty('refresh_token');

    const cookies = setCookies(res);
    expectAuthCookie(cookies.sda_access, REFRESH_TTL);
    expectAuthCookie(cookies.sda_refresh, REFRESH_TTL, '/api/v1/auth');
    expect(cookies.sda_access!.value).toBe(body.data.access_token);
    expect(cookies.sda_refresh!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookies.sda_access!.attrs.secure).toBeUndefined();

    const row = await findUserByEmail(getProductDatabase(), addr);
    expect(row!.hashed_password).toMatch(/^\$argon2id\$/);
  });

  it('normalizes the email domain like pydantic EmailStr (local part kept)', async () => {
    const local = `Mixed${++seq}`;
    const res = await register(post('/auth/register', { email: `${local}@Example.TEST`, password: STRONG }));
    expect((await json(res)).data.user.email).toBe(`${local}@example.test`);
    const again = await login(post('/auth/login', { email: `${local}@EXAMPLE.test`, password: STRONG }));
    expect(again.status).toBe(200);
  });

  it('sets Secure cookies in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await register(post('/auth/register', { email: email(), password: STRONG }));
    expect(res.status).toBe(200);
    const cookies = setCookies(res);
    expect(cookies.sda_access!.attrs.secure).toBe(true);
    expect(cookies.sda_refresh!.attrs.secure).toBe(true);
  });

  it('duplicate email is a structured 409 error without cookies', async () => {
    const addr = email();
    expect((await register(post('/auth/register', { email: addr, password: STRONG }))).status).toBe(200);
    const res = await register(post('/auth/register', { email: addr, password: STRONG }));
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body).toMatchObject({ success: false, data: null, error: { code: 'CONFLICT_EMAIL_EXISTS', retryable: false } });
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('enforces the legacy password policy with a 400', async () => {
    const res = await register(post('/auth/register', { email: email(), password: 'alllowercase1!' }));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatchObject({
      code: 'VAL_INVALID_PASSWORD',
      message: 'Password must contain at least one uppercase letter',
    });
  });

  it('invalid email -> 422 INVALID_INPUT; malformed JSON -> 400', async () => {
    const bad = await register(post('/auth/register', { email: 'nope', password: STRONG }));
    expect(bad.status).toBe(422);
    expect((await json(bad)).error.code).toBe('VAL_INVALID_INPUT');
    const malformed = await register(post('/auth/register', '{"email":'));
    expect(malformed.status).toBe(400);
    expect((await json(malformed)).error.code).toBe('VAL_INVALID_REQUEST');
  });
});

describe('POST /auth/login', () => {
  it('logs in a legacy bcrypt user and a legacy argon2 user without rehashing', async () => {
    const db = getProductDatabase();
    for (const hash of [legacy.bcrypt_hash, legacy.argon2_hash]) {
      const user = await insertUser(db, { email: email(), hashed_password: hash, name: 'Legacy' });
      const res = await login(post('/auth/login', { email: user.email, password: legacy.password }));
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.data).toMatchObject({ token_type: 'bearer', expires_in: ACCESS_TTL, user: { id: user.id, email: user.email } });
      expect(body.data).not.toHaveProperty('token');
      const cookies = setCookies(res);
      expectAuthCookie(cookies.sda_access, REFRESH_TTL);
      expectAuthCookie(cookies.sda_refresh, REFRESH_TTL, '/api/v1/auth');
      expect((await findUserByEmail(db, user.email))!.hashed_password).toBe(hash);
    }
  });

  it('accepts a legacy password that would fail the registration policy', async () => {
    const db = getProductDatabase();
    const { hashPassword } = await import('@/modules/auth/password');
    const user = await insertUser(db, { email: email(), hashed_password: await hashPassword('weak', { skipPolicy: true }) });
    const res = await login(post('/auth/login', { email: user.email, password: 'weak' }));
    expect(res.status).toBe(200);
  });

  it('wrong password, unknown email, password-less and deleted users -> 401 without cookies', async () => {
    const db = getProductDatabase();
    const known = await insertUser(db, { email: email(), hashed_password: legacy.argon2_hash });
    const sso = await insertUser(db, { email: email(), hashed_password: null });
    const gone = await insertUser(db, { email: email(), hashed_password: legacy.argon2_hash });
    await updateUserRow(db, gone.id, { is_deleted: true });
    for (const [addr, pw] of [
      [known.email, 'WrongPass1!'],
      ['missing@example.test', legacy.password],
      [sso.email, legacy.password],
      [gone.email, legacy.password],
    ] as const) {
      const res = await login(post('/auth/login', { email: addr, password: pw }));
      expect(res.status).toBe(401);
      expect((await json(res)).error.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });
});

describe('JSON content type is required (CSRF hardening)', () => {
  it('text/plain POST to /auth/login -> 415 without cookies, even with valid credentials', async () => {
    const addr = email();
    expect((await register(post('/auth/register', { email: addr, password: STRONG }))).status).toBe(200);
    const res = await login(
      new Request('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ email: addr, password: STRONG }),
      }),
    );
    expect(res.status).toBe(415);
    expect((await json(res)).error.code).toBe('VAL_UNSUPPORTED_MEDIA_TYPE');
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the cookie only and returns short access credentials', async () => {
    const registered = await register(post('/auth/register', { email: email(), password: STRONG }));
    const original = setCookies(registered).sda_refresh!.value;
    const res = await refresh(post('/auth/refresh', {}, { cookie: `sda_refresh=${original}` }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Object.keys(body.data).sort()).toEqual(['access_token', 'expires_in', 'token_type']);
    expect(body.data.expires_in).toBe(ACCESS_TTL);
    const cookies = setCookies(res);
    expect(cookies.sda_refresh!.value).not.toBe(original);
    expect(cookies.sda_refresh!.attrs.path).toBe('/api/v1/auth');
    expect(cookies.sda_access!.value).toBe(body.data.access_token);
  });
  it('rejects missing, stateless legacy and invalid refresh cookies', async () => {
    for (const cookie of ['', 'garbage', legacy.refresh_token, await issueRefreshToken('42')]) {
      const res = await refresh(post('/auth/refresh', undefined, { cookie: `sda_refresh=${cookie}` }));
      expect(res.status).toBe(401);
      expect((await json(res)).error.code).toBe(cookie ? 'AUTH_TOKEN_INVALID' : 'AUTH_TOKEN_MISSING');
    }
  });
});

describe('POST /auth/logout', () => {
  it('returns {ok:true} and deletes both cookies', async () => {
    const res = await logout(post('/auth/logout', undefined, { cookie: 'sda_access=a; sda_refresh=b' }));
    expect(res.status).toBe(200);
    expect((await json(res)).data).toEqual({ ok: true });
    const cookies = setCookies(res);
    expectDeleted(cookies.sda_access);
    expectDeleted(cookies.sda_refresh, '/api/v1/auth');
  });
});

describe('POST /admin/auth/login', () => {
  it('issues admin access only, sets access cookie and deletes the user refresh cookie', async () => {
    const res = await adminLogin(
      post('/admin/auth/login', { username: 'root', password: ADMIN_PASSWORD }, { cookie: 'sda_refresh=user-refresh' }),
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Object.keys(body.data).sort()).toEqual(['access_token', 'expires_in', 'token_type']);
    expect(body.data).toMatchObject({ token_type: 'bearer', expires_in: ACCESS_TTL });
    const claims = await verifyToken(body.data.access_token, 'access');
    expect(claims).toEqual({ sub: 'admin', admin: true, type: 'access', exp: expect.any(Number) });
    const cookies = setCookies(res);
    expectAuthCookie(cookies.sda_access, ACCESS_TTL);
    expect(cookies.sda_access!.value).toBe(body.data.access_token);
    expectDeleted(cookies.sda_refresh, '/api/v1/auth');
  });

  it('wrong username or password -> 401 without cookies', async () => {
    for (const creds of [
      { username: 'root', password: 'nope' },
      { username: 'admin', password: ADMIN_PASSWORD },
    ]) {
      const res = await adminLogin(post('/admin/auth/login', creds));
      expect(res.status).toBe(401);
      expect((await json(res)).error.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it('never falls back to the legacy default password when ADMIN_PASSWORD is unset', async () => {
    vi.stubEnv('ADMIN_USERNAME', 'admin');
    vi.stubEnv('ADMIN_PASSWORD', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const password of ['admin123', '']) {
      const res = await adminLogin(post('/admin/auth/login', { username: 'admin', password }));
      expect([401, 422]).toContain(res.status);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    const res = await adminLogin(post('/admin/auth/login', { username: 'admin', password: 'admin123' }));
    expect(res.status).toBe(401);
    warn.mockRestore();
  });
});

describe('requireUser', () => {
  it('accepts the access cookie and a Bearer header; Bearer wins over cookie', async () => {
    const db = getProductDatabase();
    const a = await insertUser(db, { email: email() });
    const b = await insertUser(db, { email: email() });
    const tokenA = await issueAccessToken(String(a.id));
    const tokenB = await issueAccessToken(String(b.id));
    expect((await requireUser(req({ cookie: `sda_access=${tokenA}` }), db)).id).toBe(a.id);
    expect((await requireUser(req({ authorization: `Bearer ${tokenB}` }), db)).id).toBe(b.id);
    expect((await requireUser(req({ authorization: `bearer ${tokenB}`, cookie: `sda_access=${tokenA}` }), db)).id).toBe(b.id);
  });

  it('invalid Bearer does not fall back to a valid cookie', async () => {
    const db = getProductDatabase();
    const a = await insertUser(db, { email: email() });
    const tokenA = await issueAccessToken(String(a.id));
    for (const authorization of ['Bearer garbage', 'Bearer ', 'Basic dXNlcjpwYXNz', `Bearer ${await issueRefreshToken(String(a.id))}`]) {
      await expect(requireUser(req({ authorization, cookie: `sda_access=${tokenA}` }), db)).rejects.toMatchObject({
        status: 401,
        code: 'AUTH_INVALID_TOKEN',
      });
    }
  });

  it('rejects missing, refresh, admin, unknown-user and deleted-user tokens with 401', async () => {
    const db = getProductDatabase();
    const gone = await insertUser(db, { email: email() });
    await updateUserRow(db, gone.id, { is_deleted: true });
    const cases = [
      req(),
      req({ cookie: `sda_access=${await issueRefreshToken(String(gone.id))}` }),
      req({ authorization: `Bearer ${await issueAccessToken('admin', true)}` }),
      req({ authorization: `Bearer ${await issueAccessToken('999999')}` }),
      req({ authorization: `Bearer ${await issueAccessToken(String(gone.id))}` }),
      req({ authorization: `Bearer ${await issueAccessToken('7abc')}` }),
    ];
    for (const r of cases) {
      await expect(requireUser(r, db)).rejects.toMatchObject({ status: 401, code: r.headers.has('authorization') || r.headers.has('cookie') ? 'AUTH_INVALID_TOKEN' : 'AUTH_TOKEN_MISSING' });
    }
  });
});

describe('requireAdmin', () => {
  it('accepts admin token from Bearer or cookie', async () => {
    const admin = await issueAccessToken('admin', true);
    expect(await requireAdmin(req({ authorization: `Bearer ${admin}` }))).toEqual({ sub: 'admin', admin: true });
    expect(await requireAdmin(req({ cookie: `sda_access=${admin}` }))).toEqual({ sub: 'admin', admin: true });
  });

  it('user access token -> 403; refresh/missing/invalid -> 401; invalid Bearer does not fall back', async () => {
    const admin = await issueAccessToken('admin', true);
    await expect(requireAdmin(req({ authorization: `Bearer ${await issueAccessToken('5')}` }))).rejects.toMatchObject({
      status: 403,
      code: 'AUTHZ_INSUFFICIENT_PERMISSION',
    });
    for (const r of [
      req(),
      req({ authorization: `Bearer ${await issueRefreshToken('5')}` }),
      req({ authorization: 'Bearer nope', cookie: `sda_access=${admin}` }),
    ]) {
      await expect(requireAdmin(r)).rejects.toMatchObject({ status: 401, code: r.headers.has('authorization') ? 'AUTH_INVALID_TOKEN' : 'AUTH_TOKEN_MISSING' });
    }
  });
});

const register = dispatch;
const login = dispatch;
const refresh = dispatch;
const logout = dispatch;
const adminLogin = dispatch;
