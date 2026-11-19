import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { createDebugRun, getDebugRun, parseDebugRunSse, streamDebugRun } from './debug-run';

const ok = (data: unknown) => new Response(JSON.stringify({ status: 200, success: true, data, error: null }), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const failure = (status: number, code: string, details?: unknown) => new Response(JSON.stringify({
  status, success: false, data: null, error: { code, message: code, details },
}), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('debug-run API', () => {
  it('creates a JSON debug run', async () => {
    const result = { run_id: 'dbg_0123456789abcdef01234567', status: 'completed' };
    const fetchMock = vi.fn().mockResolvedValue(ok(result));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createDebugRun({ message: 'học phí MTU' })).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/agent/draft/debug-runs', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'học phí MTU' }),
      credentials: 'same-origin',
    }));
  });

  it('preserves validation issues from a 422 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failure(422, 'VAL_INVALID_INPUT', {
      issues: [{ path: 'workflow.nodes[1]', code: 'workflow_unwired_label', message: 'missing label' }],
    })));

    await expect(createDebugRun({ message: 'test' })).rejects.toMatchObject({
      code: 'VAL_INVALID_INPUT',
      httpStatus: 422,
      details: { issues: [{ path: 'workflow.nodes[1]' }] },
    });
  });

  it('maps an expired stored run to RES_NOT_FOUND', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(failure(404, 'RES_NOT_FOUND'))));
    const error = await getDebugRun('dbg_0123456789abcdef01234567').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'RES_NOT_FOUND', httpStatus: 404 });
  });

  it('parses SSE records and keeps incomplete trailing data', () => {
    const parsed = parseDebugRunSse('event: delta\ndata: {"event":"delta","text":"Xin"}\n\n' +
      'event: completed\ndata: {"event":"completed","result":{"run_id":"dbg_x"}}\n\n' +
      'event: delta\ndata: {"event":"delta"}');
    expect(parsed.events).toHaveLength(2);
    expect(parsed.events[0]).toMatchObject({ event: 'delta', text: 'Xin' });
    expect(parsed.remainder).toContain('event: delta');
  });

  it('streams node events and the completed result', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: workflow.node_started\ndata: {"event":"workflow.node_started","node_id":"start","type":"start","order":1}\n\n'));
        controller.enqueue(new TextEncoder().encode('event: completed\ndata: {"event":"completed","result":{"run_id":"dbg_0123456789abcdef01234567"}}\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })));

    const events = [];
    for await (const event of streamDebugRun({ interaction: { action: 'confirm_answer' } })) events.push(event);
    expect(events.map((event) => event.event)).toEqual(['workflow.node_started', 'completed']);
  });

  it('yields run_not_saved after completed instead of failing the run', async () => {
    serve(['event: completed\ndata: {"event":"completed","result":{"run_id":"dbg_x"}}\n\n',
      'event: run_not_saved\ndata: {"reason":"store_failed"}\n\n']);
    await expect(collect()).resolves.toEqual([
      { event: 'completed', result: { run_id: 'dbg_x' } },
      { event: 'run_not_saved', reason: 'store_failed' },
    ]);
  });

  it('throws an ApiError for the runtime error frame', async () => {
    serve(['event: delta\ndata: {"event":"delta","text":"a"}\n\n',
      'event: error\ndata: {"event":"error","code":"INTERNAL_ERROR"}\n\n']);
    const seen: string[] = [];
    const error = await (async () => {
      for await (const event of streamDebugRun({ message: 'x' })) seen.push(event.event);
    })().catch((reason: unknown) => reason);
    expect(seen).toEqual(['delta']);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'SYS_INTERNAL_ERROR' });
  });

  it('skips pings, unknown events and mismatched frames, and joins UTF-8 split across chunks', async () => {
    const delta = new TextEncoder().encode('event: delta\ndata: {"event":"delta","text":"Học phí"}\n\n');
    serve([': ping\n\n', 'event: future.thing\ndata: {"event":"future.thing"}\n\n',
      'event: delta\ndata: {"event":"completed"}\n\n', delta.slice(0, 40), delta.slice(40)]);
    await expect(collect()).resolves.toEqual([{ event: 'delta', text: 'Học phí' }]);
  });

  it('cancels the response body when the caller stops early', async () => {
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"event":"delta","text":"a"}\n\n')); },
      cancel() { cancelled = true; },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    for await (const event of streamDebugRun({ message: 'x' })) {
      expect(event.event).toBe('delta');
      break;
    }
    expect(cancelled).toBe(true);
  });

  it('refreshes an expired session once and retries the stream', async () => {
    vi.stubGlobal('navigator', { locks: { request: (_name: string, task: () => Promise<boolean>) => task() } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(failure(401, 'AUTH_TOKEN_EXPIRED'))
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(stream(['event: completed\ndata: {"event":"completed","result":{"run_id":"dbg_x"}}\n\n']));
    vi.stubGlobal('fetch', fetchMock);
    await expect(collect()).resolves.toHaveLength(1);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/admin/agent/draft/debug-runs', '/api/v1/auth/refresh', '/api/v1/admin/agent/draft/debug-runs']);
  });

  it('reports a non-envelope proxy error by its status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 })));
    await expect(collect()).rejects.toMatchObject({ name: 'ApiError', code: 'HTTP_502', httpStatus: 502 });
  });

  it('keeps an HTTP error envelope from the stream request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(failure(429, 'SYS_RATE_LIMITED')));
    await expect(collect()).rejects.toMatchObject({ code: 'SYS_RATE_LIMITED', httpStatus: 429 });
  });
});

function stream(chunks: (string | Uint8Array)[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function serve(chunks: (string | Uint8Array)[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(stream(chunks)));
}

async function collect() {
  const events: unknown[] = [];
  for await (const event of streamDebugRun({ message: 'x' })) events.push(event);
  return events;
}
