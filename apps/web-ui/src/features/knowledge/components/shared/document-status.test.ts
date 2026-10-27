import { describe, expect, it } from 'vitest';
import type { DocumentDetail, DocumentSummary } from '../../types';
import { documentStatus } from './document-status';

const summary = (patch: Partial<DocumentSummary>): DocumentSummary => ({
  id: 'd1', status: 'active', revision: 2, title: 'D1', index_status: 'ready', active_revision: 1, updated_at: '2026-10-27T00:00:00Z', ...patch,
});

describe('documentStatus', () => {
  it('maps archived first, then the latest index state', () => {
    expect(documentStatus(summary({ status: 'archived', index_status: 'error' }))).toMatchObject({ kind: 'archived', label: 'Đã tắt', tone: 'neutral' });
    expect(documentStatus(summary({ index_status: 'error' }))).toMatchObject({ label: 'Lỗi index', tone: 'danger' });
    expect(documentStatus(summary({ index_status: 'pending' }))).toEqual({ kind: 'indexing', label: 'Đang index', tone: 'warning', hint: 'Agent vẫn dùng r1' });
    expect(documentStatus(summary({ index_status: 'indexing', active_revision: null })).hint).toBeUndefined();
    expect(documentStatus(summary({}))).toEqual({ kind: 'ready', label: 'Sẵn sàng', tone: 'success' });
  });

  it('reads the latest revision and its error from a document detail', () => {
    const detail: DocumentDetail = {
      id: 'd1', kb_id: 'kb1', status: 'active', revision: 2, updated_at: '2026-10-27T00:00:00Z', active: { revision: 1 },
      latest: { revision: 2, title: 'D1', body: '', source_url: null, metadata: {}, index_status: 'error', error: 'embedding timeout', created_at: '2026-10-27T00:00:00Z' },
    };
    expect(documentStatus(detail)).toEqual({ kind: 'error', label: 'Lỗi index', tone: 'danger', hint: 'embedding timeout' });
  });
});
