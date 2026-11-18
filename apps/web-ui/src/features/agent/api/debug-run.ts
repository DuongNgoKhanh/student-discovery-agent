import { api, fetchWithRefresh } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { mapErrorMessage } from '@/lib/api/error-map';
import { unwrap } from '@/lib/api/response';
import { canonicalErrorCode } from '@/generated/error-codes';
import type {
  WorkflowDebugRunRequest,
  WorkflowDebugRunResult,
  WorkflowDebugStreamEvent,
} from '../types';

const DRAFT_RUNS = 'admin/agent/draft/debug-runs';

/**
 * Studio appends this after `completed` when it could not store the run: the result is still shown, but its run id
 * cannot be reopened with `getDebugRun`.
 */
export interface DebugRunNotSavedEvent { event: 'run_not_saved'; reason: string }

/** Every frame a caller sees. A runtime `error` frame is never yielded: the stream throws an ApiError instead. */
export type DebugRunEvent = WorkflowDebugStreamEvent | DebugRunNotSavedEvent;

const KNOWN = new Set<string>(['workflow.node_started', 'workflow.node_finished', 'delta', 'completed']);

/** A runtime `error` frame (`{event: 'error', code}`), the stream's last frame when the run itself failed. */
function streamError(data: unknown): ApiError {
  const raw = (data as { code?: unknown } | null)?.code;
  const code = canonicalErrorCode(typeof raw === 'string' ? raw : '') ?? 'SYS_INTERNAL_ERROR';
  return new ApiError({ code, message: mapErrorMessage(code), httpStatus: 200 });
}

function toEvent(name: string, payload: string): DebugRunEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    // The completed result is the whole run, so it cannot be skipped; any other frame is replaceable by it.
    if (name === 'completed') throw new Error('Malformed debug-run completed frame');
    return null;
  }
  if (name === 'error') throw streamError(data);
  if (name === 'run_not_saved') {
    const reason = (data as { reason?: unknown } | null)?.reason;
    return { event: 'run_not_saved', reason: typeof reason === 'string' ? reason : 'unknown' };
  }
  // Unknown or mismatched frames are skipped, so a newer server can add events without breaking this client.
  if (!KNOWN.has(name) || (data as { event?: unknown } | null)?.event !== name) return null;
  return data as WorkflowDebugStreamEvent;
}

/**
 * Parse complete SSE records; an incomplete trailing record is returned as `remainder` for the next chunk.
 * Comments (`: ping`) and records without `event:`/`data:` are skipped. A runtime `error` frame throws ApiError.
 */
export function parseDebugRunSse(input: string): { events: DebugRunEvent[]; remainder: string } {
  const records = input.split(/\r?\n\r?\n/);
  const remainder = records.pop() ?? '';
  const events: DebugRunEvent[] = [];

  for (const record of records) {
    let eventName: string | undefined;
    const data: string[] = [];
    for (const line of record.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!eventName || data.length === 0) continue;
    const event = toEvent(eventName, data.join('\n'));
    if (event) events.push(event);
  }
  return { events, remainder };
}

/** JSON mode: the run's final result. Studio answers JSON whenever Accept does not ask for an event stream. */
export function createDebugRun(request: WorkflowDebugRunRequest): Promise<WorkflowDebugRunResult> {
  return api.post<WorkflowDebugRunResult>(DRAFT_RUNS, request);
}

/** A stored run, kept 24 hours; after that 404 RES_NOT_FOUND. */
export function getDebugRun(runId: string): Promise<WorkflowDebugRunResult> {
  return api.get<WorkflowDebugRunResult>(`admin/agent/debug-runs/${encodeURIComponent(runId)}`);
}

/**
 * Stream a debug run. The request is sent when iteration begins, so an abandoned iterator creates no run.
 * HTTP errors and a runtime `error` frame throw ApiError. Leaving the loop early (break, throw, abort) cancels the
 * response body, which tells the runtime to stop the run and frees the admin's in-flight slot in Studio.
 */
export async function* streamDebugRun(
  request: WorkflowDebugRunRequest,
  signal?: AbortSignal,
): AsyncGenerator<DebugRunEvent> {
  const response = await fetchWithRefresh(DRAFT_RUNS, {
    method: 'POST',
    headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    try {
      await unwrap<never>(response); // throws ApiError for an error envelope
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // A proxy error page (e.g. an HTML 502) is not an envelope: report the status, not a JSON SyntaxError.
    }
    const code = `HTTP_${response.status}`;
    throw new ApiError({ code, message: mapErrorMessage(code), httpStatus: response.status });
  }
  if (!response.body) throw new Error('Debug-run stream has no response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let remainder = '';
  let finished = false;
  try {
    while (true) {
      const chunk = await reader.read();
      remainder += decoder.decode(chunk.value, { stream: !chunk.done });
      const parsed = parseDebugRunSse(remainder);
      remainder = parsed.remainder;
      for (const event of parsed.events) yield event;
      if (chunk.done) break;
    }
    if (remainder.trim()) {
      for (const event of parseDebugRunSse(`${remainder}\n\n`).events) yield event;
    }
    finished = true;
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
