import { jwtVerify } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kickIndexing, setIndexKicker } from '@/modules/knowledge/index-kick';
import { INDEX_RUNS_TARGET, requestIndexRun } from '@/modules/knowledge/runtime-client';

const KEY = Buffer.from('studio-test-key-at-least-32-bytes!!');
const ctx = { requestId: 'req', traceId: 'trace' };

describe('requestIndexRun', () => {
  beforeEach(() => {
    vi.stubEnv('RUNTIME_INTERNAL_URL', 'http://runtime.test');
    vi.stubEnv('STUDIO_RUNTIME_SIGNING_KEY', KEY.toString('base64'));
    vi.stubEnv('STUDIO_RUNTIME_SIGNING_KID', 'studio');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('posts {} signed with purpose knowledge.index', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { status: 'started' } }), { status: 202 }));
    expect(await requestIndexRun(ctx)).toEqual({ status: 'started' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`http://runtime.test${INDEX_RUNS_TARGET}`);
    expect(init!.body).toBe('{}');
    const headers = init!.headers as Record<string, string>;
    expect(headers['x-internal-caller']).toBe('sda-studio-api');
    const { payload } = await jwtVerify(headers['x-caller-context']!, new Uint8Array(KEY), { issuer: 'sda-studio-api', audience: 'sda-agent-runtime' });
    expect(payload).toMatchObject({ purpose: 'knowledge.index', method: 'POST', request_target: INDEX_RUNS_TARGET });
  });

  it('maps runtime 503 and network failure to SYS_UNAVAILABLE', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{"success":false}', { status: 503 }));
    await expect(requestIndexRun(ctx)).rejects.toMatchObject({ status: 503, code: 'SYS_UNAVAILABLE' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('boom'));
    await expect(requestIndexRun(ctx)).rejects.toMatchObject({ status: 503 });
  });

  it('reports runtime_starting when the kick times out (a sleeping runtime is booting)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    await expect(requestIndexRun(ctx)).rejects.toMatchObject({
      status: 503, code: 'SYS_UNAVAILABLE', retryable: true, details: { kind: 'runtime_starting' },
    });
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    await expect(requestIndexRun(ctx)).rejects.toMatchObject({ details: { kind: 'runtime_starting' } });
  });

  it('is unavailable when the runtime is not configured', async () => {
    vi.stubEnv('RUNTIME_INTERNAL_URL', '');
    await expect(requestIndexRun(ctx)).rejects.toMatchObject({ status: 503 });
  });
});

describe('kickIndexing', () => {
  afterEach(() => setIndexKicker(null));

  it('never throws or rejects when the kicker fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setIndexKicker(() => Promise.reject(new Error('secret http://u:p@x')));
    expect(() => kickIndexing(ctx)).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret');
    setIndexKicker(() => { throw new Error('sync'); });
    expect(() => kickIndexing(ctx)).not.toThrow();
    spy.mockRestore();
  });
});
