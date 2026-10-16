
export interface RequestContext {
  requestId: string;
  traceId: string;
}

/** URL parameters supplied by the HTTP router. */
export interface RouteContext<P = Record<string, never>> {
  params: P;
}
