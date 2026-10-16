import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getSession, SessionApiUnavailable } from './session.server';

let incoming: Headers;
vi.mock('next/headers', () => ({ headers: async () => incoming }));
beforeEach(() => {
  incoming = new Headers({ cookie: 'sda_access=opaque-access', 'x-request-id': 'ui-request' });
  vi.stubEnv('STUDIO_API_ORIGIN', 'http://studio-api:3001');
  for (const key of ['SECRET_KEY', 'DATABASE_URL', 'S3_SECRET_KEY']) vi.stubEnv(key, '');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const envelope = (data: unknown) => ({
  success: true, status: 200, data, error: null, message: null,
  meta: { request_id: 'r', trace_id: 't', timestamp: '2026-10-16T00:00:00Z' },
});

it.each([{ userId: '7', isAdmin: false }, { userId: 'admin', isAdmin: true }])(
  'obtains verified session metadata over HTTP without Product secrets', async (session) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(envelope(session)));
    expect(await getSession()).toEqual(session);
    expect(fetch).toHaveBeenCalledWith('http://studio-api:3001/api/v1/auth/session', expect.objectContaining({
      cache: 'no-store', headers: expect.any(Headers),
    }));
    const sent = fetch.mock.calls[0]![1]!.headers as Headers;
    expect(sent.get('cookie')).toBe('sda_access=opaque-access');
    expect(sent.get('x-request-id')).toBe('ui-request');
  },
);

it('returns null only for an unauthorized API response', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));
  expect(await getSession()).toBeNull();
});

it.each([503, 403])('surfaces API failure %s instead of redirecting to login', async (status) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status }));
  await expect(getSession()).rejects.toBeInstanceOf(SessionApiUnavailable);
});

it('surfaces network failures and invalid successful responses', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network unavailable'));
  await expect(getSession()).rejects.toBeInstanceOf(SessionApiUnavailable);
  fetch.mockResolvedValueOnce(Response.json(envelope({ userId: 7, isAdmin: true })));
  await expect(getSession()).rejects.toBeInstanceOf(SessionApiUnavailable);
});
