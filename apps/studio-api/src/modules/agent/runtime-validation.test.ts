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

  it('is 503 when the runtime is not configured', async () => {
    vi.stubEnv('STUDIO_RUNTIME_SIGNING_KEY', '');
    await expect(validateWithRuntime({}, ctx)).rejects.toMatchObject({ status: 503 });
  });
});
