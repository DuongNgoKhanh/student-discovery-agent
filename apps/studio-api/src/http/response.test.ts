import { describe, it, expect } from 'vitest';
import { success, failure } from '@/http/response';
import { ProductError } from '@/http/errors';
import { withHandler } from '@/http/handler';
import type { RequestContext, RouteContext } from '@/http/types';

const ctx: RequestContext = { requestId: 'req-test', traceId: 'trace-test' };

describe('success', () => {
  it('success_preserves_http_status_and_metadata', async () => {
    const response = success({ ok: true }, ctx, 201);
    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({
      status: 201,
      success: true,
      data: { ok: true },
      error: null,
      meta: { request_id: 'req-test', trace_id: 'trace-test' },
    });
  });

  it('defaults to 200, message null and merges extra top-level fields', async () => {
    const body = await success({ a: 1 }, ctx, undefined, { message: 'done' }).json();
    expect(body.status).toBe(200);
    expect(body.message).toBe('done');
    const plain = await success(null, ctx).json();
    expect(plain.message).toBeNull();
    expect(plain.data).toBeNull();
  });

  it('timestamp is a valid UTC ISO string ending in Z', async () => {
    const body = await success({}, ctx).json();
    expect(body.meta.timestamp).toMatch(/Z$/);
    expect(new Date(body.meta.timestamp).toISOString()).toBe(body.meta.timestamp);
  });
});

describe('failure', () => {
  it('maps ProductError to envelope with code/message/retryable/details', async () => {
    const err = new ProductError(409, 'REVISION_CONFLICT', 'conflict', true, { kind: 'revision_conflict' });
    expect(err.status).toBe(409);
    expect(err.code).toBe('REVISION_CONFLICT');
    expect(err.retryable).toBe(true);
    const response = failure(err, ctx);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: 409,
      success: false,
      data: null,
      error: { code: 'CONFLICT_REVISION', legacy_code: 'REVISION_CONFLICT', message: 'conflict', retryable: true, details: { kind: 'revision_conflict' } },
      meta: { request_id: 'req-test', trace_id: 'trace-test' },
    });
  });

  it('defaults retryable=false and details=null', async () => {
    const body = await failure(new ProductError(404, 'RESOURCE_NOT_FOUND', 'nope'), ctx).json();
    expect(body.error).toEqual({ code: 'RES_NOT_FOUND', legacy_code: 'RESOURCE_NOT_FOUND', message: 'nope', retryable: false, details: null });
  });

  it('hides unknown errors behind INTERNAL_ERROR 500', async () => {
    const response = failure(new Error('secret db password'), ctx);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe('SYS_INTERNAL_ERROR');
    expect(body.error.legacy_code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('secret db password');
  });
});

describe('withHandler', () => {
  const route: RouteContext<{ id: string }> = { params: { id: '7' } };

  it('passes request, context and URL params to handler', async () => {
    const handler = withHandler<{ id: string }>(async (_req, c, r) => {
      const { id } = r.params;
      return success({ id, requestId: c.requestId }, c);
    });
    const res = await handler(new Request('http://x/api/v1/a/7', { headers: {
      'x-request-id': '11111111-1111-4111-8111-111111111111',
      'x-trace-id': '22222222-2222-4222-8222-222222222222',
    } }), route);
    const body = await res.json();
    expect(body.data).toEqual({ id: '7', requestId: '11111111-1111-4111-8111-111111111111' });
    expect(body.meta.trace_id).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('generates ids when headers are absent', async () => {
    const handler = withHandler<{ id: string }>(async (_req, c) => success({}, c));
    const body = await (await handler(new Request('http://x/'), route)).json();
    expect(body.meta.request_id).toBeTruthy();
    expect(body.meta.trace_id).toBeTruthy();
  });

  it('converts thrown ProductError and unknown errors into envelopes', async () => {
    const h1 = withHandler<{ id: string }>(async () => {
      throw new ProductError(401, 'AUTH_REQUIRED', 'login');
    });
    expect((await h1(new Request('http://x/'), route)).status).toBe(401);
    const h2 = withHandler<{ id: string }>(async () => {
      throw new Error('boom');
    });
    const res = await h2(new Request('http://x/'), route);
    expect(res.status).toBe(500);
  });
});

it('merges pagination metadata while preserving authoritative correlation IDs', async () => {
  const response = success({ items: [] }, { requestId: 'request', traceId: 'trace' }, 200, {
    meta: { pagination: { limit: 20, next_cursor: null, has_more: false }, request_id: 'forged', trace_id: 'forged', timestamp: 'forged' },
  });
  const body = await response.json();
  expect(body.meta).toMatchObject({ request_id: 'request', trace_id: 'trace', pagination: { limit: 20, next_cursor: null, has_more: false } });
  expect(body.meta.timestamp).toMatch(/^\d{4}-/);
});
