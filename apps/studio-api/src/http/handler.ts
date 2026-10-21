import { failure } from '@/http/response';
import type { RequestContext, RouteContext } from '@/http/types';
import type { Handler } from 'hono';

const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function idFrom(req: Request, header: string): string {
  const v = req.headers.get(header);
  return v && UUID_ID.test(v) ? v.toLowerCase() : crypto.randomUUID();
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
