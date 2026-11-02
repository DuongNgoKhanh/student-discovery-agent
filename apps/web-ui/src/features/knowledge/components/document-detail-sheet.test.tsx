import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { knowledgeApi } from '../api/knowledge';
import type { DocumentDetail } from '../types';
import { DocumentDetailSheet } from './document-detail-sheet';

vi.mock('../api/knowledge', () => ({
  knowledgeApi: { getDocument: vi.fn(), listFields: vi.fn(), retryRevision: vi.fn(), archiveDocument: vi.fn(), restoreDocument: vi.fn() },
}));
const mocked = vi.mocked(knowledgeApi);
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const detail = (patch: Partial<DocumentDetail['latest']> = {}, status: DocumentDetail['status'] = 'active'): DocumentDetail => ({
  id: 'hutech', kb_id: 'kb1', status, revision: 3, updated_at: '2026-10-27T00:00:00Z', active: { revision: 2 },
  latest: {
    revision: 3, title: 'HUTECH', body: '', source_url: 'https://hutech.edu.vn', metadata: { truong: 'HUTECH', nganh: ['CNTT', 'Luật'] },
    index_status: 'ready', error: null, created_at: '2026-10-27T00:00:00Z', ...patch,
  },
});

const renderSheet = (props: Partial<React.ComponentProps<typeof DocumentDetailSheet>> = {}) =>
  renderWithProviders(<DocumentDetailSheet kb="kb1" docId="hutech" open onOpenChange={() => {}} {...props} />);

describe('DocumentDetailSheet', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.listFields.mockResolvedValue([
      { id: 'f2', name: 'nganh', type: 'string_list', label: 'Ngành', filterable: true, ordinal: 1 },
      { id: 'f1', name: 'truong', type: 'string', label: 'Trường', filterable: true, ordinal: 0 },
    ]);
  });

  it('shows the latest index error, focuses it and retries the revision', async () => {
    mocked.getDocument.mockResolvedValue(detail({ index_status: 'error', error: 'embedding timeout' }));
    mocked.retryRevision.mockResolvedValue(detail({ index_status: 'pending' }));
    renderSheet({ focus: 'error' });
    const block = (await screen.findByText('Lỗi gần nhất')).closest('section')!;
    expect(within(block).getByText('embedding timeout')).toBeInTheDocument();
    await waitFor(() => expect(block).toHaveFocus());
    expect(screen.getByText(/Bản mới nhất r3 · Agent đang dùng r2/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /hutech\.edu\.vn/ })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('Ngành').nextSibling).toHaveTextContent('CNTT, Luật');
    expect(screen.getByRole('link', { name: 'Mở trong trình soạn' })).toHaveAttribute('href', '/admin/knowledge/kb1/documents/hutech');
    fireEvent.click(within(block).getByRole('button', { name: 'Thử index lại' }));
    await waitFor(() => expect(mocked.retryRevision).toHaveBeenCalledWith({ kb: 'kb1', doc: 'hutech', revision: 3 }));
  });

  it('puts the retrieved chunk on top', async () => {
    mocked.getDocument.mockResolvedValue(detail());
    renderSheet({ chunk: { content: 'Học phí ngành CNTT', chunk: 4, revision: 2, score: 0.8123, query: 'học phí' } });
    const block = screen.getByText('Đoạn được truy xuất').closest('section')!;
    expect(block).toHaveTextContent('Chunk #4 · r2 · 0.812');
    expect([...block.querySelectorAll('mark')].map(mark => mark.textContent)).toEqual(['Học', 'phí']);
    expect(await screen.findByText('Sẵn sàng')).toBeInTheDocument();
    expect(screen.queryByText('Lỗi gần nhất')).not.toBeInTheDocument();
  });

  it('confirms before turning retrieval off and restores directly', async () => {
    mocked.getDocument.mockResolvedValue(detail());
    mocked.archiveDocument.mockResolvedValue(detail({}, 'archived'));
    renderSheet();
    fireEvent.click(await screen.findByRole('switch', { name: 'Cho phép truy xuất' }));
    expect(await screen.findByText('Agent sẽ không truy xuất tài liệu này nữa. Dữ liệu không bị xoá.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tắt truy xuất' }));
    await waitFor(() => expect(mocked.archiveDocument).toHaveBeenCalledWith({ kb: 'kb1', doc: 'hutech', expected_revision: 3 }));
  });
});
