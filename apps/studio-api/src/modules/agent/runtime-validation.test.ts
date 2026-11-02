import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeJwt } from 'jose';
import { validateWithRuntime, VALIDATE_TARGET } from '@/modules/agent/runtime-validation';

const KEY = Buffer.alloc(32, 9).toString('base64');
const ctx = { requestId: 'r', traceId: 't' };

beforeEach(() => {
  vi.stubEnv('RUNTIME_INTERNAL_URL', 'http://runtime:8000');
  vi.stubEnv('STUDIO_RUNTIME_SIGNING_KEY', KEY);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const respond = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));

describe('validateWithRuntime', () => {
  it('signs with purpose agent.validate and returns the report', async () => {
    respond(200, { success: true, data: { valid: true, content_hash: 'sha256:a', issues: [] } });
    await expect(validateWithRuntime({ greeting_text: 'x' }, ctx)).resolves.toEqual({ valid: true, content_hash: 'sha256:a', issues: [] });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe(`http://runtime:8000${VALIDATE_TARGET}`);
    expect(JSON.parse(init!.body as string)).toEqual({ content: { greeting_text: 'x' } });
    expect(decodeJwt((init!.headers as Record<string, string>)['x-caller-context']!)).toMatchObject({ purpose: 'agent.validate' });
  });

  it.each([
    ['runtime error', () => respond(503, { success: false, error: { code: 'SYS_UNAVAILABLE' } })],
    ['malformed report', () => respond(200, { success: true, data: { valid: 'yes' } })],
    ['network failure', () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))],
  ])('never treats %s as a pass', async (_name, arrange) => {
    arrange();
    await expect(validateWithRuntime({}, ctx)).rejects.toMatchObject({ status: 503, code: 'SYS_UNAVAILABLE' });
  });

  it.each([
    ['an outage', () => respond(503, { success: false, error: { code: 'SYS_UNAVAILABLE' } }), 503, 'dependency_down', true],
    ['a timeout', () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('slow', 'TimeoutError'))), 503, 'timeout', true],
    ['a rejected key (401)', () => respond(401, { success: false, error: { code: 'AUTH_CALLER_CONTEXT_INVALID' } }), 503, 'misconfigured', false],
    ['a wrong purpose (403)', () => respond(403, { success: false, error: { code: 'FORBIDDEN' } }), 503, 'misconfigured', false],
    ['a refused request (422)', () => respond(422, { success: false, error: { code: 'INVALID_INPUT' } }), 500, 'runtime_rejected', false],
  ])('classifies %s so only transient failures ask for a retry', async (_name, arrange, status, kind, retryable) => {
    arrange();
    const error = await validateWithRuntime({}, ctx).catch(e => e);
    expect(error).toMatchObject({ status, retryable, details: { kind } });
  });

  it('logs the runtime error code and the fetch failure name', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    respond(403, { success: false, error: { code: 'FORBIDDEN' } });
    await validateWithRuntime({}, ctx).catch(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await validateWithRuntime({}, ctx).catch(() => {});
    expect(log.mock.calls).toEqual([
      ['[agent] runtime validation failed', { status: 403, runtimeCode: 'FORBIDDEN', requestId: 'r' }],
      ['[agent] runtime validation unreachable', { error: 'TypeError', requestId: 'r' }],
    ]);
    log.mockRestore();
  });

  it('is 503 when the runtime is not configured', async () => {
    vi.stubEnv('STUDIO_RUNTIME_SIGNING_KEY', '');
    await expect(validateWithRuntime({}, ctx)).rejects.toMatchObject({ status: 503 });
  });
});
