import 'server-only';
import { ZodError } from 'zod';
import { ProductError } from './errors';
import type { RequestContext } from './types';

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
    },
  });
}

/** Contract (common.yaml ErrorDetail.details) allows only object|null. */
function normalizeDetails(details: unknown): Record<string, unknown> | null {
  if (details === undefined || details === null) return null;
  if (typeof details === 'object' && !Array.isArray(details)) return details as Record<string, unknown>;
  return { value: details };
}

export function success<T>(
  data: T,
  ctx: RequestContext,
  status = 200,
  extra: Record<string, unknown> = {},
): Response {
  return json(
    { message: null, status, success: true, data, error: null, meta: meta(ctx), ...extra },
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
  return json(
    {
      status: e.status,
      success: false,
      message: e.message,
      data: null,
      error: { code: e.code, message: e.message, retryable: e.retryable, details: normalizeDetails(e.details) },
      meta: meta(ctx),
    },
    e.status,
    ctx,
  );
}
