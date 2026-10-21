import { beforeAll, beforeEach, afterAll, expect, it, vi } from 'vitest';
import { dispatch } from '../helpers/api';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { closeProductDatabase, getProductDatabase } from '@/infrastructure/db/client';
import { sql } from 'drizzle-orm';
let pg: PostgresHandle;
beforeAll(async () => { pg = await startPostgres(); await migrateProduct(pg.url); });
afterAll(async () => { await closeProductDatabase(); await pg?.stop(); vi.unstubAllEnvs(); });
beforeEach(async () => {
  vi.stubEnv('DATABASE_URL', pg.url); vi.stubEnv('SECRET_KEY', 'security-regression-test-key');
  vi.stubEnv('NODE_ENV', 'test');
  const table = await getProductDatabase().execute(sql`SELECT to_regclass('product.auth_registration_limits') AS present`);
  if (table.rows[0]?.present) await getProductDatabase().execute(sql`TRUNCATE product.auth_registration_limits`);
});
function request(path: string, body?: unknown, headers: Record<string,string> = {}) {
  return dispatch(new Request(`http://localhost/api/v1/auth/${path}`, {
    method: 'POST', headers: { origin: 'http://localhost', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}
function refreshCookie(response: Response) {
  return response.headers.getSetCookie().find(line => line.startsWith('sda_refresh=') && !line.includes('Max-Age=0'))!.split(';')[0]!;
}
async function registered() {
  const res = await request('register', { email: `${crypto.randomUUID()}@example.test`, password: 'Str0ng!Pass' });
  expect(res.status).toBe(200); return { res, body: await res.json(), cookie: refreshCookie(res) };
}
it('register returns a short access credential and cookie-only opaque refresh session', async () => {
  const { res, body, cookie } = await registered();
  expect(body.data.expires_in).toBe(1800); expect(body.data).not.toHaveProperty('refresh_token');
  expect(cookie.split('=')[1]).not.toContain('.');
  const line = res.headers.getSetCookie().find(v => v.startsWith(cookie))!;
  expect(line).toContain('Path=/api/v1/auth'); expect(line).toContain('Max-Age=1209600');
  expect(line).toContain('HttpOnly'); expect(line).toContain('SameSite=Lax'); expect(line).not.toContain('Secure');
  const stored = await getProductDatabase().execute(sql`SELECT token_hash FROM product.auth_refresh_tokens`);
  expect(stored.rows.some(row => row.token_hash === cookie.split('=')[1])).toBe(false);
});
it('rotates refresh credentials and reuse revokes the entire session and access credentials', async () => {
  const { cookie, body } = await registered();
  const rotated = await request('refresh', undefined, { cookie }); expect(rotated.status).toBe(200);
  const next = refreshCookie(rotated); expect(next).not.toBe(cookie);
  expect((await rotated.json()).data).not.toHaveProperty('refresh_token');
  expect((await request('refresh', undefined, { cookie })).status).toBe(401);
  expect((await request('refresh', undefined, { cookie: next })).status).toBe(401);
  const session = await dispatch(new Request('http://localhost/api/v1/auth/session', { headers: { authorization: `Bearer ${body.data.access_token}` } }));
  expect(session.status).toBe(401); expect((await session.json()).error.code).toBe('AUTH_TOKEN_INVALID');
});
it('only one concurrent refresh can consume a credential and reuse invalidates the winner', async () => {
  const { cookie } = await registered();
  const responses = await Promise.all([request('refresh', undefined, { cookie }), request('refresh', undefined, { cookie })]);
  expect(responses.map(r => r.status).sort()).toEqual([200,401]);
  expect((await request('refresh', undefined, { cookie: refreshCookie(responses.find(r=>r.status===200)!) })).status).toBe(401);
});
it('logout revokes both refresh and previously issued access credentials', async () => {
  const { cookie, body } = await registered();
  expect((await request('logout', undefined, { cookie })).status).toBe(200);
  expect((await request('refresh', undefined, { cookie })).status).toBe(401);
  const res = await dispatch(new Request('http://localhost/api/v1/auth/session', { headers: { authorization: `Bearer ${body.data.access_token}` } }));
  expect(res.status).toBe(401);
});
it('rejects body refresh credentials and cross-origin or unproven refresh/logout calls', async () => {
  const { cookie } = await registered();
  expect((await request('refresh', { refresh_token: cookie.split('=')[1] })).status).toBe(422);
  for (const path of ['refresh', 'logout']) {
    expect((await request(path, undefined, { cookie, origin: 'https://evil.test' })).status).toBe(403);
    expect((await request(path, undefined, { cookie, origin: '', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await request(path, undefined, { cookie, origin: '' })).status).toBe(403);
  }
});
it('duplicate registration is409 and attempts are bounded by email and trusted peer despite forged XFF', async () => {
  const addr = `${crypto.randomUUID()}@example.test`; const input = { email: addr, password: 'Str0ng!Pass' };
  expect((await request('register', input)).status).toBe(200);
  const duplicate = await request('register', input); expect(duplicate.status).toBe(409);
  expect((await duplicate.json()).error.code).toBe('CONFLICT_EMAIL_EXISTS');
  for (let i=0;i<3;i++) await request('register', input);
  const blocked = await request('register', input, { 'x-forwarded-for': '203.0.113.45' });
  expect(blocked.status).toBe(429);
  for (let i=0;i<15;i++) await request('register', { email: `${crypto.randomUUID()}@example.test`, password: 'weak' }, { 'x-forwarded-for': `203.0.113.${i}` });
  expect((await request('register', { email: `${crypto.randomUUID()}@example.test`, password: 'Str0ng!Pass' })).status).toBe(429);
});

it('trusted gateway clients have separate IP registration budgets', async () => {
  vi.stubEnv('AUTH_TRUSTED_PROXY_HOSTS','localhost');
  const { setTrustedPeer, limitRegistration } = await import('@/modules/auth/registration-limit');
  const db = getProductDatabase();
  function forwarded(ip: string) {
    const req = new Request('http://localhost/api/v1/auth/register',{headers:{'x-sda-client-ip':ip}});
    setTrustedPeer(req,ip.endsWith('.1') ? '::ffff:127.0.0.1' : '::ffff:7f00:1'); return req;
  }
  for (let i=0;i<20;i++) await limitRegistration(db,forwarded('198.51.100.1'),`${i}@first.test`);
  await expect(limitRegistration(db,forwarded('198.51.100.1'),'blocked@first.test')).rejects.toMatchObject({status:429});
  await expect(limitRegistration(db,forwarded('198.51.100.2'),'allowed@second.test')).resolves.toBeUndefined();
});
it('untrusted peers cannot change registration identity through forged forwarded headers', async () => {
  vi.stubEnv('AUTH_TRUSTED_PROXY_HOSTS','192.0.2.10');
  const { setTrustedPeer, limitRegistration } = await import('@/modules/auth/registration-limit');
  const db=getProductDatabase();
  for (let i=0;i<21;i++) {
    const req = new Request('http://localhost/api/v1/auth/register',{headers:{'x-sda-client-ip':`198.51.100.${i}`,'x-forwarded-for':`198.51.100.${i}`}});
    setTrustedPeer(req,'203.0.113.99');
    if (i<20) await limitRegistration(db,req,`${i}@forged.test`);
    else await expect(limitRegistration(db,req,`${i}@forged.test`)).rejects.toMatchObject({status:429});
  }
});
it('access-only logout revokes its family even when the refresh cookie is absent', async () => {
  const { body, cookie } = await registered();
  expect((await request('logout',undefined,{authorization:`Bearer ${body.data.access_token}`})).status).toBe(200);
  expect((await request('refresh',undefined,{cookie})).status).toBe(401);
  const res = await dispatch(new Request('http://localhost/api/v1/auth/session',{headers:{authorization:`Bearer ${body.data.access_token}`}}));
  expect(res.status).toBe(401);
});
it('DNS lookup failure falls back to the verified socket peer without a server error', async () => {
  vi.stubEnv('AUTH_TRUSTED_PROXY_HOSTS','gateway-missing.invalid');
    const { setTrustedPeer, limitRegistration } = await import('@/modules/auth/registration-limit');
    const db=getProductDatabase();
    for (let i=0;i<21;i++) {
      const req=new Request('http://localhost',{headers:{'x-sda-client-ip':`198.51.100.${i}`}});
      setTrustedPeer(req,'203.0.113.99');
      if (i<20) await expect(limitRegistration(db,req,`${i}@dns.test`)).resolves.toBeUndefined();
      else await expect(limitRegistration(db,req,`${i}@dns.test`)).rejects.toMatchObject({status:429});
    }
});
