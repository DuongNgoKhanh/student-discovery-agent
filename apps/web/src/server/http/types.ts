import 'server-only';

export interface RequestContext {
  requestId: string;
  traceId: string;
}

/** Next 15 route context: dynamic params are a Promise. */
export interface RouteContext<P = Record<string, never>> {
  params: Promise<P>;
}
