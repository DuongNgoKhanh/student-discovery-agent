import { z } from 'zod';
import { getKnowledgeEnv } from '@/config/env';
import type { ProductDatabase } from '@/infrastructure/db/client';
import { ProductError } from '@/http/errors';
import type { RequestContext } from '@/http/types';
import { signingKey, signServiceRequest } from '@/modules/knowledge/runtime-client';
import * as repo from '@/modules/agent/agent.repository';
import * as runs from '@/modules/agent/debug-runs.repository';
import { getAgentValidator } from '@/modules/agent/runtime-validation';

export const DEBUG_TARGET = '/api/v1/internal/agent-debug-runs:run';
/** DEC-24: real-model debug runs per admin per hour; a run whose model calls were all stubbed does not count. */
export const MODEL_RUNS_PER_HOUR = 30;
const TIMEOUT_MS = 40_000; // one turn is at most 30 s in the runtime, plus the hop
const BODY_LIMIT = 64 * 1024;
export const DEBUG_BODY = { maxBytes: BODY_LIMIT };

const object = z.record(z.unknown());
export const debugRunRequestSchema = z.object({
  message: z.string().min(1).max(4000).optional(),
  interaction: z.object({
    action: z.string().min(1), outcome: z.string().min(1).optional(), option_id: z.string().min(1).optional(),
  }).strict().optional(),
  state: z.object({
    profile: object.optional(), result: object.nullable().optional(), conv: object.optional(), activity: object.nullable().optional(),
  }).strict().optional(),
  llm_stubs: object.optional(),
}).strict().refine(v => (v.message === undefined) !== (v.interaction === undefined),
  'Cần đúng một trong message hoặc interaction');
export type DebugRunRequest = z.infer<typeof debugRunRequestSchema>;

export const debugRunIdSchema = z.string().regex(/^dbg_[0-9a-f]{24}$/);

const resultSchema = z.object({
  run_id: debugRunIdSchema,
  live_llm_calls: z.number().int().min(0),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime(),
}).passthrough();

export type RuntimeCaller = (body: string, accept: string, ctx: RequestContext) => Promise<Response>;

const unavailable = (kind: string) =>
  new ProductError(503, 'SYS_UNAVAILABLE', 'Agent debug run is unavailable', kind === 'dependency_down' || kind === 'timeout', { kind });

async function callRuntime(body: string, accept: string, ctx: RequestContext): Promise<Response> {
  const env = getKnowledgeEnv();
  const key = signingKey(env.STUDIO_RUNTIME_SIGNING_KEY);
  if (!env.RUNTIME_INTERNAL_URL || !key) throw unavailable('not_configured');
  const token = await signServiceRequest('POST', DEBUG_TARGET, body, key, env.STUDIO_RUNTIME_SIGNING_KID, Date.now(), 'agent.validate');
  try {
    return await fetch(new URL(DEBUG_TARGET, env.RUNTIME_INTERNAL_URL), {
      method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json', accept, 'x-internal-caller': 'sda-studio-api', 'x-caller-context': token,
        'x-request-id': ctx.requestId, 'x-trace-id': ctx.traceId,
      },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    console.error('[agent] runtime debug run unreachable', { error: name, requestId: ctx.requestId });
    throw unavailable(name === 'TimeoutError' ? 'timeout' : 'dependency_down');
  }
}

let caller: RuntimeCaller = callRuntime;
/** Test seam: integration tests replace the runtime call; `null` restores the real client. */
export function setRuntimeCaller(fn: RuntimeCaller | null): void { caller = fn ?? callRuntime; }

type Envelope = { success?: boolean; data?: unknown; error?: { code?: unknown } } | null;
const readEnvelope = (response: Response) => response.json().catch(() => null) as Promise<Envelope>;

function runtimeFailure(response: Response, envelope: Envelope, ctx: RequestContext): ProductError {
  const code = typeof envelope?.error?.code === 'string' ? envelope.error.code : undefined;
  console.error('[agent] runtime debug run failed', { status: response.status, code, requestId: ctx.requestId });
  if (response.status === 429) return new ProductError(429, 'SYS_RATE_LIMITED', 'Too many debug runs in progress', true);
  if (response.status === 401 || response.status === 403) return unavailable('misconfigured');
  if (response.status >= 400 && response.status < 500) {
    return new ProductError(422, 'VAL_INVALID_INPUT', 'The runtime rejected this debug run', false,
      { kind: 'runtime_rejected', runtime_status: response.status, ...(code ? { runtime_code: code } : {}) });
  }
  return unavailable('dependency_down');
}

/**
 * Runs in flight per admin in this process. A run only counts once its row is stored, so without this a burst of
 * concurrent requests would all read the same count and pass. It does not cover several studio-api instances.
 */
const inFlight = new Map<string, number>();
const reserve = (actor: string) => { inFlight.set(actor, (inFlight.get(actor) ?? 0) + 1); };
function release(actor: string): void {
  const left = (inFlight.get(actor) ?? 1) - 1;
  if (left > 0) inFlight.set(actor, left); else inFlight.delete(actor);
}

async function prepare(db: ProductDatabase, request: DebugRunRequest, actor: string, ctx: RequestContext) {
  const draft = await repo.getDraft(db);
  if (!draft) throw new ProductError(404, 'RES_NOT_FOUND', 'Agent draft not found');
  if (await runs.countLiveModelRuns(db, actor) + (inFlight.get(actor) ?? 0) >= MODEL_RUNS_PER_HOUR) {
    throw new ProductError(429, 'SYS_RATE_LIMITED', 'Debug run allowance used up for this hour', true, { kind: 'debug_run_hourly_limit' });
  }
  // Only the graph needs to be sound to run it; the persona cases are the Validate button's job.
  const report = await getAgentValidator()(draft.content, ctx, { personas: false });
  if (!report.valid) {
    throw new ProductError(422, 'VAL_INVALID_INPUT', 'Agent draft failed validation', false, { kind: 'validation', issues: report.issues });
  }
  return { draft, body: JSON.stringify({ content: draft.content, request }) };
}

type Draft = { revision: number; content_hash: string };

async function store(db: ProductDatabase, draft: Draft, request: DebugRunRequest,
  actor: string, result: z.infer<typeof resultSchema>): Promise<void> {
  await runs.insertDebugRun(db, {
    run_id: result.run_id, actor_id: actor, draft_revision: draft.revision, content_hash: draft.content_hash,
    request: request as Record<string, unknown>, result: result as Record<string, unknown>,
    live_llm_calls: result.live_llm_calls, created_at: new Date(result.created_at), expires_at: new Date(result.expires_at),
  });
}

export async function runDebugRun(db: ProductDatabase, request: DebugRunRequest, actor: string, ctx: RequestContext) {
  const { draft, body } = await prepare(db, request, actor, ctx);
  reserve(actor);
  try {
    const response = await caller(body, 'application/json', ctx);
    const envelope = await readEnvelope(response);
    if (!response.ok || !envelope?.success) throw runtimeFailure(response, envelope, ctx);
    const parsed = resultSchema.safeParse(envelope.data);
    if (!parsed.success) {
      // The runtime already spent the model calls: a result we cannot read is a contract mismatch, not an outage to retry.
      console.error('[agent] runtime debug run returned an unreadable result',
        { issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.code}`), requestId: ctx.requestId });
      throw unavailable('bad_runtime_response');
    }
    try {
      await store(db, draft, request, actor, parsed.data);
    } catch (error) {
      console.error('[agent] could not store a debug run', { run_id: parsed.data.run_id, error: error instanceof Error ? error.name : 'Error', requestId: ctx.requestId });
      throw error;
    }
    return parsed.data;
  } finally {
    release(actor);
  }
}

const notSaved = (reason: string) =>
  new TextEncoder().encode(`event: run_not_saved\ndata: ${JSON.stringify({ reason })}\n\n`);

/**
 * Passes the runtime's frames through untouched. The `completed` frame is saved before the chunk that carries it is
 * forwarded; if it cannot be saved the client gets a trailing `run_not_saved` frame, so a run id is never shown as
 * reopenable when it is not. The stream's end releases the admin's in-flight slot; a client that disconnects leaves it to the timeout below.
 */
function relay(source: ReadableStream<Uint8Array>, save: (result: z.infer<typeof resultSchema>) => Promise<void>,
  ctx: RequestContext, done: () => void) {
  const decoder = new TextDecoder();
  let buffer = '';
  let sawCompleted = false;
  /** Returns a reason when the frame was a `completed` one that could not be stored. */
  async function handle(frame: string): Promise<string | null> {
    // Split on \n only: JSON from the runtime may carry U+2028/U+2029, which a regex `.` or `$` would cut at.
    const lines = frame.split('\n');
    if (!lines.includes('event: completed')) return null;
    sawCompleted = true;
    const data = lines.filter(line => line.startsWith('data: ')).map(line => line.slice(6)).join('\n');
    try {
      const parsed = resultSchema.safeParse((JSON.parse(data || 'null') as { result?: unknown } | null)?.result);
      if (!parsed.success) {
        console.error('[agent] streamed debug run result unreadable',
          { issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.code}`), requestId: ctx.requestId });
        return 'unreadable_result';
      }
      try {
        await save(parsed.data);
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        console.error('[agent] could not store a streamed debug run', { run_id: parsed.data.run_id,
          error: error instanceof Error ? error.name : 'Error', code: typeof code === 'string' ? code : undefined, requestId: ctx.requestId });
        return 'store_failed';
      }
      return null;
    } catch (error) {
      console.error('[agent] malformed completed frame', { error: error instanceof Error ? error.name : 'Error', requestId: ctx.requestId });
      return 'malformed_frame';
    }
  }
  return source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let failure: string | null = null;
      for (let cut = buffer.indexOf('\n\n'); cut >= 0; cut = buffer.indexOf('\n\n')) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        failure = (await handle(frame)) ?? failure;
      }
      controller.enqueue(chunk);
      if (failure) controller.enqueue(notSaved(failure));
    },
    async flush(controller) {
      buffer += decoder.decode();
      // A last frame without its blank line still counts.
      const failure = buffer.trim() ? await handle(buffer) : null;
      if (failure) controller.enqueue(notSaved(failure));
      if (!sawCompleted) console.error('[agent] debug run stream ended without a completed frame', { requestId: ctx.requestId });
      done();
    },
  }));
}

export async function streamDebugRun(db: ProductDatabase, request: DebugRunRequest, actor: string, ctx: RequestContext): Promise<Response> {
  const { draft, body } = await prepare(db, request, actor, ctx);
  reserve(actor);
  let released = false;
  const safety = setTimeout(() => done(), TIMEOUT_MS); // a disconnected client never reaches flush()
  const done = () => { clearTimeout(safety); if (!released) { released = true; release(actor); } };
  try {
    const response = await caller(body, 'text/event-stream', ctx);
    if (!response.ok) throw runtimeFailure(response, await readEnvelope(response), ctx);
    if (!response.body) throw unavailable('dependency_down');
    return new Response(relay(response.body, result => store(db, draft, request, actor, result), ctx, done), {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': ctx.requestId, 'x-trace-id': ctx.traceId },
    });
  } catch (error) {
    done();
    throw error;
  }
}

export async function readDebugRun(db: ProductDatabase, runId: string): Promise<Record<string, unknown>> {
  const row = await runs.findLiveDebugRun(db, runId);
  if (!row) throw new ProductError(404, 'RES_NOT_FOUND', 'Debug run not found');
  return row.result;
}
