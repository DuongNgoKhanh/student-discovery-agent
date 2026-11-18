import { ApiError } from '@/lib/api/errors';
import { unwrap } from '@/lib/api/response';
import type {
  WorkflowDebugRunRequest,
  WorkflowDebugRunResult,
  WorkflowDebugStreamEvent,
} from '../types';

const BASE = '/api/v1/admin/agent';

/** Parse one or more SSE records. Incomplete trailing records are returned to the caller. */
export function parseDebugRunSse(input: string): {
  events: WorkflowDebugStreamEvent[];
  remainder: string;
} {
  const records = input.split(/\r?\n\r?\n/);
  const remainder = records.pop() ?? '';
  const events: WorkflowDebugStreamEvent[] = [];

  for (const record of records) {
    let eventName: string | undefined;
    const data: string[] = [];
    for (const line of record.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (!eventName || data.length === 0) continue;
    const parsed: unknown = JSON.parse(data.join('\n'));
    if (!parsed || typeof parsed !== 'object' || (parsed as { event?: unknown }).event !== eventName) {
      throw new Error('Invalid debug-run SSE event');
    }
    events.push(parsed as WorkflowDebugStreamEvent);
  }
  return { events, remainder };
}

function streamUrl() {
  return `${BASE}/draft/debug-runs`;
}

export async function createDebugRun(request: WorkflowDebugRunRequest): Promise<WorkflowDebugRunResult> {
  const response = await fetch(streamUrl(), {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(request),
    credentials: 'same-origin',
  });
  return unwrap<WorkflowDebugRunResult>(response);
}

export async function getDebugRun(runId: string): Promise<WorkflowDebugRunResult> {
  const response = await fetch(`${BASE}/debug-runs/${encodeURIComponent(runId)}`, {
    method: 'GET',
    credentials: 'same-origin',
  });
  return unwrap<WorkflowDebugRunResult>(response);
}

/**
 * Start a streaming debug run. The request is sent when iteration begins, so an
 * abandoned iterator does not create a run. HTTP errors are normalized to ApiError.
 */
export async function* streamDebugRun(
  request: WorkflowDebugRunRequest,
  signal?: AbortSignal,
): AsyncGenerator<WorkflowDebugStreamEvent> {
  const response = await fetch(streamUrl(), {
    method: 'POST',
    headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify(request),
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) {
    await unwrap<never>(response);
    return;
  }
  if (!response.body) throw new Error('Debug-run stream has no response body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let remainder = '';
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
      const parsed = parseDebugRunSse(`${remainder}\n\n`);
      for (const event of parsed.events) yield event;
    }
  } finally {
    reader.releaseLock();
  }
}

export const debugRunApi = { create: createDebugRun, get: getDebugRun, stream: streamDebugRun };

export function isDebugRunApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
