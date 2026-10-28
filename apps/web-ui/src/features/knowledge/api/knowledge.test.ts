import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { knowledgeApi } from './knowledge';

afterEach(() => vi.restoreAllMocks());

describe('knowledgeApi.listDocuments', () => {
  it('sends only set filters and returns next_cursor from meta.pagination', async () => {
    const spy = vi.spyOn(api, 'getWithMeta').mockResolvedValue({
      data: { items: [] }, meta: { pagination: { limit: 20, next_cursor: 'c2', has_more: true } },
    });
    expect(await knowledgeApi.listDocuments('kb1', { q: 'học phí', index_status: 'error', cursor: undefined, limit: 20 }))
      .toEqual({ items: [], next_cursor: 'c2' });
    expect(spy).toHaveBeenCalledWith('admin/knowledge-bases/kb1/documents?q=h%E1%BB%8Dc+ph%C3%AD&index_status=error&limit=20');
  });
});
