import { createHash } from 'node:crypto';
import { jwtVerify } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '@/app';
import { ownerCookieValue, readOwner } from '@/modules/conversations/owner';
import { signStudentRequest } from '@/modules/conversations/runtime-proxy';

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');
const ORIGIN = 'http://localhost:3000';
const OWNER = `own_${'a'.repeat(32)}`;

beforeEach(() => {
  vi.stubEnv('SECRET_KEY', 'test-secret-key');
  vi.stubEnv('RUNTIME_INTERNAL_URL', 'http://runtime:8000');
  vi.stubEnv('PRODUCT_RUNTIME_SIGNING_KEY', KEY_B64);
  vi.stubEnv('PRODUCT_BASE_URL', ORIGIN);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const withCookie = (value: string) => ({ cookie: `sda_owner=${value}` });

describe('owner cookie', () => {
  it('accepts only a value signed with the server secret', () => {
    const valid = new Request('http://x/', { headers: withCookie(ownerCookieValue(OWNER)) });
    expect(readOwner(valid)).toBe(OWNER);
    const other = `own_${'b'.repeat(32)}`;
    const swapped = ownerCookieValue(OWNER).replace(OWNER, other);
    expect(readOwner(new Request('http://x/', { headers: withCookie(swapped) }))).toBeUndefined();
    expect(readOwner(new Request('http://x/', { headers: withCookie(OWNER) }))).toBeUndefined();
  });
});

describe('signStudentRequest', () => {
  it('binds the student owner to method, target and body', async () => {
    const key = new Uint8Array(Buffer.from(KEY_B64, 'base64'));
    const body = '{"idempotency_key":"k1"}';
    const token = await signStudentRequest('POST', '/api/v1/internal/conversations', body, OWNER, key, 'local');
    const { payload, protectedHeader } = await jwtVerify(token, key, { issuer: 'sda-product-bff', audience: 'sda-agent-runtime' });
    expect(protectedHeader).toEqual({ alg: 'HS256', typ: 'sda-internal+jwt', kid: 'local' });
    expect(payload).toMatchObject({
      caller_type: 'student', owner_id: OWNER, method: 'POST', request_target: '/api/v1/internal/conversations',
      body_sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
    });
  });
});

describe('conversation routes', () => {
  function runtimeReturns(status: number, body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('creates an owner cookie on the first conversation and forwards the body unchanged', async () => {
    const fetchMock = runtimeReturns(201, { status: 201, success: true, data: { conversation: { id: 'c1' } } });
    const body = '{"idempotency_key":"k1","schema_version":1}';
    const res = await createApp().request('/api/v1/conversations', { method: 'POST', body, headers: { origin: ORIGIN } });
    expect(res.status).toBe(201);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^sda_owner=own_[0-9a-f]{32}\./);
    expect(cookie).toContain('Path=/api/v1');
    expect(cookie).toContain('HttpOnly');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://runtime:8000/api/v1/internal/conversations');
    expect(init.body).toBe(body);
    expect(init.headers['x-internal-caller']).toBe('sda-product-bff');
  });

  it('keeps an existing owner instead of issuing a new cookie', async () => {
    runtimeReturns(201, { status: 201, success: true, data: {} });
    const res = await createApp().request('/api/v1/conversations', {
      method: 'POST', body: '{}', headers: { origin: ORIGIN, ...withCookie(ownerCookieValue(OWNER)) },
    });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects reads without an owner cookie before calling the runtime', async () => {
    const fetchMock = runtimeReturns(200, {});
    const res = await createApp().request('/api/v1/conversations/c1');
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects cross-site message posts', async () => {
    const fetchMock = runtimeReturns(200, {});
    const res = await createApp().request('/api/v1/conversations/c1/messages', {
      method: 'POST', body: '{}', headers: { origin: 'https://evil.example', ...withCookie(ownerCookieValue(OWNER)) },
    });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes runtime errors through with their status and code', async () => {
    runtimeReturns(409, { status: 409, success: false, data: null, error: { code: 'CONFLICT_REVISION' } });
    const res = await createApp().request('/api/v1/conversations/c1/messages', {
      method: 'POST', body: '{}', headers: { origin: ORIGIN, ...withCookie(ownerCookieValue(OWNER)) },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONFLICT_REVISION');
  });

  it('answers 503 when the runtime is not configured', async () => {
    vi.stubEnv('PRODUCT_RUNTIME_SIGNING_KEY', '');
    const res = await createApp().request('/api/v1/responses/r1', { headers: withCookie(ownerCookieValue(OWNER)) });
    expect(res.status).toBe(503);
  });
});
