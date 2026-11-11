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
/** DEC-24: real-model debug runs per admin per hour; a run that was fully stubbed does not count. */
export const MODEL_RUNS_PER_HOUR = 30;
const TIMEOUT_MS = 40_000; // one turn is at most 30 s in the runtime, plus the hop
const BODY_LIMIT = 64 * 1024;
export const DEBUG_BODY = { maxBytes: BODY_LIMIT };

const object = z.record(z.unknown());
export const debugRunRequestSchema = z.object({
  message: z.string().min(1).max(4000).optional(),
  interaction: object.optional(),
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

async function runtimeFailure(response: Response, ctx: RequestContext): Promise<ProductError> {
  const envelope = await response.json().catch(() => null) as { error?: { code?: unknown } } | null;
  console.error('[agent] runtime debug run failed', { status: response.status, code: envelope?.error?.code, requestId: ctx.requestId });
  if (response.status === 429) return new ProductError(429, 'SYS_RATE_LIMITED', 'Too many debug runs in progress', true);
  if (response.status === 401 || response.status === 403) return unavailable('misconfigured');
  if (response.status >= 400 && response.status < 500) {
    return new ProductError(422, 'VAL_INVALID_INPUT', 'The runtime rejected this debug run', false, { kind: 'runtime_rejected' });
  }
  return unavailable('dependency_down');
}

async function prepare(db: ProductDatabase, request: DebugRunRequest, actor: string, ctx: RequestContext) {
  const draft = await repo.getDraft(db);
  if (!draft) throw new ProductError(404, 'RES_NOT_FOUND', 'Agent draft not found');
  if (await runs.countLiveModelRuns(db, actor) >= MODEL_RUNS_PER_HOUR) {
    throw new ProductError(429, 'SYS_RATE_LIMITED', 'Debug run allowance used up for this hour', true, { kind: 'debug_run_hourly_limit' });
  }
  // Only the graph needs to be sound to run it; the persona cases are the Validate button's job.
  const report = await getAgentValidator()(draft.content, ctx, { personas: false });
  if (!report.valid) {
    throw new ProductError(422, 'VAL_INVALID_INPUT', 'Agent draft failed validation', false, { kind: 'validation', issues: report.issues });
  }
  return { draft, body: JSON.stringify({ content: draft.content, request }) };
}

async function store(db: ProductDatabase, draft: { revision: number; content_hash: string }, request: DebugRunRequest,
  actor: string, result: z.infer<typeof resultSchema>): Promise<void> {
  await runs.insertDebugRun(db, {
    run_id: result.run_id, actor_id: actor, draft_revision: draft.revision, content_hash: draft.content_hash,
    request: request as Record<string, unknown>, result: result as Record<string, unknown>,
    live_llm_calls: result.live_llm_calls, created_at: new Date(result.created_at), expires_at: new Date(result.expires_at),
  });
}

export async function runDebugRun(db: ProductDatabase, request: DebugRunRequest, actor: string, ctx: RequestContext) {
  const { draft, body } = await prepare(db, request, actor, ctx);
  const response = await caller(body, 'application/json', ctx);
  const envelope = await response.json().catch(() => null) as { success?: boolean; data?: unknown } | null;
  if (!response.ok || !envelope?.success) throw await runtimeFailure(response, ctx);
  const parsed = resultSchema.safeParse(envelope.data);
  if (!parsed.success) throw unavailable('dependency_down');
  await store(db, draft, request, actor, parsed.data);
  return parsed.data;
}

/** Passes the runtime's frames through untouched; the `completed` frame is saved before the student-facing byte that ends it. */
function relay(source: ReadableStream<Uint8Array>, save: (result: z.infer<typeof resultSchema>) => Promise<void>) {
  const decoder = new TextDecoder();
  let buffer = '';
  return source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      for (let cut = buffer.indexOf('\n\n'); cut >= 0; cut = buffer.indexOf('\n\n')) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        if (!/^event: completed$/m.test(frame)) continue;
        const data = /^data: (.*)$/m.exec(frame)?.[1];
        try {
          const parsed = resultSchema.safeParse((JSON.parse(data ?? 'null') as { result?: unknown } | null)?.result);
          if (parsed.success) await save(parsed.data);
        } catch (error) {
          console.error('[agent] could not store a streamed debug run', { error: error instanceof Error ? error.name : 'Error' });
        }
      }
      controller.enqueue(chunk);
    },
  }));
}

export async function streamDebugRun(db: ProductDatabase, request: DebugRunRequest, actor: string, ctx: RequestContext): Promise<Response> {
  const { draft, body } = await prepare(db, request, actor, ctx);
  const response = await caller(body, 'text/event-stream', ctx);
  if (!response.ok) throw await runtimeFailure(response, ctx);
  if (!response.body) throw unavailable('dependency_down');
  return new Response(relay(response.body, result => store(db, draft, request, actor, result)), {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': ctx.requestId, 'x-trace-id': ctx.traceId },
  });
}

export async function readDebugRun(db: ProductDatabase, runId: string): Promise<Record<string, unknown>> {
  const row = await runs.findLiveDebugRun(db, runId);
  if (!row) throw new ProductError(404, 'RES_NOT_FOUND', 'Debug run not found');
  return row.result;
}
