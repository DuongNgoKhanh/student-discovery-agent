import 'server-only';
import { failure } from './response';
import type { RequestContext, RouteContext } from './types';

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function idFrom(req: Request, header: string): string {
  const v = req.headers.get(header);
  return v && SAFE_ID.test(v) ? v : crypto.randomUUID();
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
