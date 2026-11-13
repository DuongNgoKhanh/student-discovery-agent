import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from '../helpers/api';
import { declaredResponseValidator } from '../helpers/openapi-response';
import { call, json, validateEnvelope } from '../helpers/users-api';
import { issueAccessToken } from '@/modules/auth/tokens';
import { NODE_TYPES_TARGET, setNodeTypeCatalogReader } from '@/modules/agent/node-types';

const catalogFixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../contracts/fixtures/workflow-node-types.json'), 'utf8').replace(/^\uFEFF/, ''),
);
const expectDeclared = (envelope: unknown, status: number) => {
  const validate = declaredResponseValidator('public/agent-api.yaml', '/admin/agent/workflow/node-types', 'get', status);
  expect(validate(envelope), JSON.stringify(validate.errors)).toBe(true);
};

let admin: string;

beforeEach(async () => {
  vi.stubEnv('SECRET_KEY', 'integration-test-secret');
  admin = await issueAccessToken('admin', true);
});

afterEach(() => {
  setNodeTypeCatalogReader(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GET /admin/agent/workflow/node-types', () => {
  it('enforces admin access with 401 and 403 matching the declared contract', async () => {
    const unauthRes = await dispatch(call('GET', '/admin/agent/workflow/node-types'));
    expect(unauthRes.status).toBe(401);
    const unauthBody = await json(unauthRes);
    expect(validateEnvelope(unauthBody)).toBe(true);
    expectDeclared(unauthBody, 401);

    const user = await issueAccessToken('7', false);
    const forbiddenRes = await dispatch(call('GET', '/admin/agent/workflow/node-types', user));
    expect(forbiddenRes.status).toBe(403);
    const forbiddenBody = await json(forbiddenRes);
    expect(validateEnvelope(forbiddenBody)).toBe(true);
    expectDeclared(forbiddenBody, 403);
  });

  it('proxies the runtime catalog to admins matching WorkflowNodeTypeCatalogEnvelope', async () => {
    vi.stubEnv('RUNTIME_INTERNAL_URL', 'http://runtime:8000');
    vi.stubEnv('STUDIO_RUNTIME_SIGNING_KEY', Buffer.alloc(32, 9).toString('base64'));
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe(`http://runtime:8000${NODE_TYPES_TARGET}`);
      return new Response(JSON.stringify({ success: true, status: 200, data: catalogFixture, error: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const res = await dispatch(call('GET', '/admin/agent/workflow/node-types', admin));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(validateEnvelope(body)).toBe(true);
    expect(body.data).toEqual(catalogFixture);
    expectDeclared(body, 200);
  });

  it('returns 503 SYS_UNAVAILABLE matching the contract when the runtime is unreachable', async () => {
    vi.stubEnv('RUNTIME_INTERNAL_URL', 'http://runtime:8000');
    vi.stubEnv('STUDIO_RUNTIME_SIGNING_KEY', Buffer.alloc(32, 9).toString('base64'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const res = await dispatch(call('GET', '/admin/agent/workflow/node-types', admin));
    expect(res.status).toBe(503);
    const body = await json(res);
    expect(validateEnvelope(body)).toBe(true);
    expect(body.error.code).toBe('SYS_UNAVAILABLE');
    expect(body.error.retryable).toBe(true);
    expectDeclared(body, 503);
  });
});
