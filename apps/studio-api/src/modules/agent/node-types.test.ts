import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '@/app';
import { issueAccessToken } from '@/modules/auth/tokens';
import {
  fetchWorkflowNodeTypes,
  NODE_TYPES_TARGET,
  setNodeTypeCatalogReader,
} from '@/modules/agent/node-types';

const KEY = Buffer.alloc(32, 9).toString('base64');
const SECRET = 'unit-test-secret-key-at-least-32-bytes';
const ctx = { requestId: 'req-1', traceId: 'trace-1' };
const catalogFixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../contracts/fixtures/workflow-node-types.json'), 'utf8').replace(/^\uFEFF/, ''),
);

beforeEach(() => {
  vi.stubEnv('RUNTIME_INTERNAL_URL', 'http://runtime:8000');
  vi.stubEnv('STUDIO_RUNTIME_SIGNING_KEY', KEY);
  vi.stubEnv('SECRET_KEY', SECRET);
});

afterEach(() => {
  setNodeTypeCatalogReader(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const respond = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  ));

describe('fetchWorkflowNodeTypes', () => {
  it('signs a GET request with purpose agent.validate and returns the runtime catalog', async () => {
    respond(200, { success: true, data: catalogFixture });
    await expect(fetchWorkflowNodeTypes(ctx)).resolves.toEqual(catalogFixture);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe(`http://runtime:8000${NODE_TYPES_TARGET}`);
    expect(init!.method).toBe('GET');
    expect(init!.body).toBeUndefined();
    const headers = init!.headers as Record<string, string>;
    expect(headers['x-internal-caller']).toBe('sda-studio-api');
    expect(decodeJwt(headers['x-caller-context']!)).toMatchObject({
      purpose: 'agent.validate',
      method: 'GET',
      request_target: NODE_TYPES_TARGET,
      body_sha256: createHash('sha256').update('', 'utf8').digest('hex'),
    });
  });

  it.each([
    ['an outage', () => respond(503, { success: false, error: { code: 'SYS_UNAVAILABLE' } }), 'dependency_down', true],
    ['a timeout', () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('slow', 'TimeoutError'))), 'timeout', true],
    ['a network failure', () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed'))), 'dependency_down', true],
    ['a rejected key (401)', () => respond(401, { success: false, error: { code: 'AUTH_CALLER_CONTEXT_INVALID' } }), 'misconfigured', false],
    ['a wrong purpose (403)', () => respond(403, { success: false, error: { code: 'FORBIDDEN' } }), 'misconfigured', false],
    ['a client error (422)', () => respond(422, { success: false, error: { code: 'INVALID_INPUT' } }), 'bad_runtime_response', false],
    ['a malformed catalog', () => respond(200, { success: true, data: { catalog_version: 'v1', namespaces: [], node_types: [] } }), 'bad_runtime_response', false],
    ['an invalid envelope', () => respond(200, { success: false }), 'bad_runtime_response', false],
  ])('maps %s to 503 SYS_UNAVAILABLE', async (_label, arrange, kind, retryable) => {
    arrange();
    const error = await fetchWorkflowNodeTypes(ctx).catch(e => e);
    expect(error).toMatchObject({ status: 503, code: 'SYS_UNAVAILABLE', retryable, details: { kind } });
  });

  it('logs the failure without leaking secrets and returns 503 when not configured', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    respond(403, { success: false, error: { code: 'FORBIDDEN' } });
    await fetchWorkflowNodeTypes(ctx).catch(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await fetchWorkflowNodeTypes(ctx).catch(() => undefined);
    expect(log.mock.calls).toEqual([
      ['[agent] runtime node-types failed', { status: 403, runtimeCode: 'FORBIDDEN', requestId: 'req-1' }],
      ['[agent] runtime node-types unreachable', { error: 'TypeError', requestId: 'req-1' }],
    ]);

    vi.stubEnv('STUDIO_RUNTIME_SIGNING_KEY', '');
    await expect(fetchWorkflowNodeTypes(ctx)).rejects.toMatchObject({
      status: 503,
      code: 'SYS_UNAVAILABLE',
      details: { kind: 'not_configured' },
    });
  });
});

describe('GET /api/v1/admin/agent/workflow/node-types route', () => {
  const app = createApp();

  it('requires an admin token (401 without token, 403 for non-admin)', async () => {
    const userToken = await issueAccessToken('7', false);
    const unauth = await app.request('/api/v1/admin/agent/workflow/node-types');
    expect(unauth.status).toBe(401);
    const forbidden = await app.request('/api/v1/admin/agent/workflow/node-types', {
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(forbidden.status).toBe(403);
  });

  it('forwards the catalog to an admin and propagates 503 on outage', async () => {
    const adminToken = await issueAccessToken('admin', true);
    setNodeTypeCatalogReader(async () => catalogFixture);
    const ok = await app.request('/api/v1/admin/agent/workflow/node-types', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(await ok.json()).toMatchObject({ success: true, status: 200, data: catalogFixture });

    setNodeTypeCatalogReader(null);
    vi.stubEnv('RUNTIME_INTERNAL_URL', '');
    const down = await app.request('/api/v1/admin/agent/workflow/node-types', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ success: false, error: { code: 'SYS_UNAVAILABLE' } });
  });
});
