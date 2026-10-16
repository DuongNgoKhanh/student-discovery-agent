import { failure } from '@/http/response';
import type { RequestContext, RouteContext } from '@/http/types';
import type { Handler } from 'hono';

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function idFrom(req: Request, header: string): string {
  const v = req.headers.get(header);
  return v && SAFE_ID.test(v) ? v : crypto.randomUUID();
}

/** Keep router-specific context out of controllers and business services. */
export function honoHandler<P extends Record<string, string>>(
  handler: (req: Request, route: RouteContext<P>) => Promise<Response>,
): Handler {
  return (context) => handler(context.req.raw, { params: context.req.param() as P });
}

export function withHandler<P = Record<string, never>>(
  handler: (req: Request, ctx: RequestContext, route: RouteContext<P>) => Promise<Response>,
): (req: Request, route: RouteContext<P>) => Promise<Response> {
  return async (req, route) => {
    const ctx: RequestContext = { requestId: idFrom(req, 'x-request-id'), traceId: idFrom(req, 'x-trace-id') };
    try {
      return await handler(req, ctx, route);
    } catch (error) {
      return failure(error, ctx);
    }
  };
}
