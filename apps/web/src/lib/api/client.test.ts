import { describe, it, expect, vi, afterEach } from 'vitest';
import { api } from './client';

afterEach(() => vi.restoreAllMocks());

describe('api.get', () => {
  it('gọi /api/bff/<path> và unwrap data', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { id: 9 } }), { status: 200 }),
    );
    const data = await api.get<{ id: number }>('users/me');
    expect(data).toEqual({ id: 9 });
    expect(spy).toHaveBeenCalledWith(
      '/api/bff/users/me',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
