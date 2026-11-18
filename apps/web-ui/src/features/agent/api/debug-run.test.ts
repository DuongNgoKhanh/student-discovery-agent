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
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'học phí MTU' }),
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
    for await (const event of streamDebugRun({ interaction: { type: 'click' } })) events.push(event);
    expect(events.map((event) => event.event)).toEqual(['workflow.node_started', 'completed']);
  });
});
