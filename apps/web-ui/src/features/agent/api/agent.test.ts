import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentApi } from './agent';

const ok = (data: unknown, meta: unknown = {}) => new Response(JSON.stringify({ status: 200, success: true, data, error: null,
  meta: { request_id: 'r', trace_id: 't', timestamp: 'x', ...meta as object } }), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('agentApi', () => {
  it('restores with the :restore suffix and the pointer revision', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ release_id: 'agr_x' }));
    vi.stubGlobal('fetch', fetchMock);
    await agentApi.restore({ id: 'agr_0123', expected_active_revision: 4, idempotency_key: 'restore-abc12345' });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/v1/admin/agent/releases/agr_0123:restore');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ expected_active_revision: 4, idempotency_key: 'restore-abc12345' });
  });

  it('pages releases through meta.pagination', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ items: [{ id: 'a' }] }, { pagination: { next_cursor: 'c2' } })));
    await expect(agentApi.listReleases()).resolves.toEqual({ items: [{ id: 'a' }], next_cursor: 'c2' });
  });
});
