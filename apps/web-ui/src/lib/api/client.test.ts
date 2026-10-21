import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { api } from './client';

beforeEach(() => {
  let tail: Promise<unknown> = Promise.resolve();
  vi.stubGlobal('navigator', { locks: { request: (_name: string, callback: () => Promise<unknown>) => {
    const next = tail.then(callback); tail = next.catch(() => {}); return next;
  } } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200 });
const unauthorized = () =>
  new Response(JSON.stringify({ success: false, error: { code: 'AUTH_TOKEN_EXPIRED' } }), { status: 401 });

describe('api', () => {
  it('gọi /api/v1/<path> và unwrap data', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ id: 9 }));
    expect(await api.get<{ id: number }>('me')).toEqual({ id: 9 });
    expect(spy).toHaveBeenCalledWith(
      '/api/v1/me',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });

  it('401 → refresh đúng một lần rồi retry với cùng body', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(ok({ id: 1 }));
    expect(await api.patch('me', { name: 'A' })).toEqual({ id: 1 });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[1]![0]).toBe('/api/v1/auth/refresh');
    const first = spy.mock.calls[0]![1] as RequestInit;
    const retry = spy.mock.calls[2]![1] as RequestInit;
    expect(first.body).toBe('{"name":"A"}');
    expect(retry.body).toBe(first.body);
    expect((retry.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('retry vẫn 401 thì ném lỗi, không refresh lần hai', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce(unauthorized());
    await expect(api.get('me')).rejects.toMatchObject({ httpStatus: 401 });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('login không bị refresh/retry khi 401', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(unauthorized());
    await expect(api.post('auth/login', { email: 'a', password: 'b' })).rejects.toBeDefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

it.each(['AUTH_TOKEN_INVALID', 'AUTH_TOKEN_MISSING'])('does not refresh %s', async code => {
  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ success:false, error:{code} }, { status:401 }));
  await expect(api.get('me')).rejects.toMatchObject({code});
  expect(spy).toHaveBeenCalledTimes(1);
});
it('coalesces concurrent expiration refreshes before retrying each request', async () => {
  let refreshes=0; let calls=0;
  vi.spyOn(globalThis,'fetch').mockImplementation(async (path) => {
    if (path === '/api/v1/auth/refresh') { refreshes++; await new Promise(resolve=>setTimeout(resolve,5)); return ok({}); }
    calls++; return calls<=2 ? unauthorized() : ok({id:1});
  });
  expect(await Promise.all([api.get('me'),api.get('me')])).toEqual([{id:1},{id:1}]);
  expect(refreshes).toBe(1);
});
