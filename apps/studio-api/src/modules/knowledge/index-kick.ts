import type { RequestContext } from '@/http/types';
import { requestIndexRun, type IndexRunStatus } from '@/modules/knowledge/runtime-client';

type Kicker = (ctx: RequestContext) => Promise<{ status: IndexRunStatus }> | void;
let current: Kicker = requestIndexRun;
/** Test seam: integration tests observe kicks without a runtime; `null` restores the real client. */
export function setIndexKicker(fn: Kicker | null): void { current = fn ?? requestIndexRun; }

/** Fire-and-forget after a committed write: never throws, never awaited, logs the failure class only. */
export function kickIndexing(ctx: RequestContext): void {
  void (async () => { await current(ctx); })().catch(error => {
    console.error('[knowledge] index kick failed', { requestId: ctx.requestId, kind: error instanceof Error ? error.name : 'unknown' });
  });
}

/** Awaited variant for the explicit admin button: errors surface to the caller. */
export async function runIndexNow(ctx: RequestContext): Promise<{ status: IndexRunStatus }> {
  return requestIndexRun(ctx);
}
