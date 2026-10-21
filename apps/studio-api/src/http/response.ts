import { ZodError } from 'zod';
import { ProductError, transportError } from '@/http/errors';
import type { RequestContext } from '@/http/types';

function meta(ctx: RequestContext) {
  return { request_id: ctx.requestId, trace_id: ctx.traceId, timestamp: new Date().toISOString() };
}

function json(body: unknown, status: number, ctx: RequestContext): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-request-id': ctx.requestId,
      'x-trace-id': ctx.traceId,
    },
  });
}

export function success<T>(
  data: T,
  ctx: RequestContext,
  status = 200,
  extra: Record<string, unknown> = {},
): Response {
  const { meta: extensions, ...fields } = extra;
  const metadata = extensions && typeof extensions === 'object' && !Array.isArray(extensions) ? extensions : {};
  return json(
    { message: null, status, success: true, data, error: null, ...fields, meta: { ...metadata, ...meta(ctx) } },
    status,
    ctx,
  );
}

export function failure(error: unknown, ctx: RequestContext): Response {
  let e: ProductError;
  if (error instanceof ProductError) {
    e = error;
  } else if (error instanceof ZodError) {
    e = new ProductError(422, 'INVALID_INPUT', 'Invalid input', false, {
      kind: 'validation',
      issues: error.issues.map((i) => ({
        path: i.path.join('.'),
        code: i.code,
        message: i.message,
        rule_id: null,
      })),
    });
  } else {
    // Never leak internals; log server-side with correlation ids.
    console.error('[http] unhandled error', { requestId: ctx.requestId, traceId: ctx.traceId, error });
    e = new ProductError(500, 'INTERNAL_ERROR', 'Internal server error', false);
  }
  const projected = transportError(e);
  return json(
    {
      status: projected.status,
      success: false,
      message: projected.error.message,
      data: null,
      error: projected.error,
      meta: meta(ctx),
    },
    projected.status,
    ctx,
  );
}
