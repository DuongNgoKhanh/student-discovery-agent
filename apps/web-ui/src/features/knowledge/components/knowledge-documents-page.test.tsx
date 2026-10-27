import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { knowledgeApi } from '../api/knowledge';
import type { DocumentDetail, DocumentSummary } from '../types';
import { KnowledgeDocumentsPage } from './knowledge-documents-page';

let search = '';
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/knowledge/kb1/documents',
}));
vi.mock('../api/knowledge', () => ({
  knowledgeApi: {
    listDocuments: vi.fn(), getDocument: vi.fn(), listFields: vi.fn(), archiveDocument: vi.fn(), restoreDocument: vi.fn(), retryRevision: vi.fn(),
  },
}));
const mocked = vi.mocked(knowledgeApi);
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

const doc = (id: string, patch: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id, status: 'active', revision: 2, title: id.toUpperCase(), index_status: 'ready', active_revision: 2, updated_at: '2026-10-27T00:00:00Z', ...patch,
});

const detail = (id: string, patch: Partial<DocumentDetail['latest']> = {}): DocumentDetail => ({
  id, kb_id: 'kb1', status: 'active', revision: 2, updated_at: '2026-10-27T00:00:00Z', active: { revision: 1 },
  latest: {
    revision: 2, title: id.toUpperCase(), body: '', source_url: null, metadata: {}, index_status: 'ready', error: null,
    created_at: '2026-10-27T00:00:00Z', ...patch,
  },
});

const renderPage = () => renderWithProviders(<KnowledgeDocumentsPage kb="kb1" />);

describe('KnowledgeDocumentsPage', () => {
  beforeEach(() => { vi.resetAllMocks(); search = ''; mocked.listFields.mockResolvedValue([]); });

  it('lists documents with their index status and confirms before turning one off', async () => {
    mocked.listDocuments.mockResolvedValue({
      items: [doc('hutech'), doc('uel', { index_status: 'error' }), doc('ftu', { status: 'archived' })], next_cursor: null,
    });
    mocked.archiveDocument.mockResolvedValue({} as never);
    renderPage();
    expect(await screen.findByRole('button', { name: 'HUTECH' })).toBeInTheDocument();
    expect(screen.getByText('Lỗi index')).toBeInTheDocument();
    // Archived rows keep their index status; the switch carries "off".
    expect(screen.getAllByText('Sẵn sàng')).toHaveLength(2);
    expect(screen.getByRole('switch', { name: 'Cho phép truy xuất: FTU' })).not.toBeChecked();
    // Error rows get no inline retry button; the status itself opens the error.
    expect(screen.queryByRole('button', { name: 'Thử lại' })).not.toBeInTheDocument();
    expect(mocked.listDocuments).toHaveBeenCalledWith('kb1', { limit: 20 });

    fireEvent.click(screen.getByRole('switch', { name: 'Cho phép truy xuất: HUTECH' }));
    expect(await screen.findByText('Agent sẽ không truy xuất tài liệu này nữa. Dữ liệu không bị xoá.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tắt truy xuất' }));
    await waitFor(() => expect(mocked.archiveDocument).toHaveBeenCalledWith({ kb: 'kb1', doc: 'hutech', expected_revision: 2 }));
  });

  it('explains the retrieval column in a tooltip', async () => {
    mocked.listDocuments.mockResolvedValue({ items: [doc('hutech')], next_cursor: null });
    renderPage();
    fireEvent.focus(await screen.findByRole('button', { name: 'Giải thích: Cho phép truy xuất' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Tắt không xoá dữ liệu, bật lại dùng được ngay.');
  });

  it('turns retrieval back on without asking', async () => {
    mocked.listDocuments.mockResolvedValue({ items: [doc('ftu', { status: 'archived' })], next_cursor: null });
    mocked.restoreDocument.mockResolvedValue({} as never);
    renderPage();
    fireEvent.click(await screen.findByRole('switch', { name: 'Cho phép truy xuất: FTU' }));
    await waitFor(() => expect(mocked.restoreDocument).toHaveBeenCalledWith({ kb: 'kb1', doc: 'ftu', expected_revision: 2 }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('opens the detail sheet from the title and syncs ?doc=', async () => {
    mocked.listDocuments.mockResolvedValue({ items: [doc('hutech')], next_cursor: null });
    mocked.getDocument.mockResolvedValue(detail('hutech'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'HUTECH' }));
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByText('Mở trong trình soạn')).toBeInTheDocument();
    expect(mocked.getDocument).toHaveBeenCalledWith('kb1', 'hutech');
    expect(replace).toHaveBeenCalledWith('/admin/knowledge/kb1/documents?doc=hutech', { scroll: false });
  });

  it('opens the sheet on the latest error from the error status', async () => {
    mocked.listDocuments.mockResolvedValue({ items: [doc('uel', { index_status: 'error' })], next_cursor: null });
    mocked.getDocument.mockResolvedValue(detail('uel', { index_status: 'error', error: 'embedding timeout' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Lỗi index: xem lỗi của UEL' }));
    const block = (await screen.findByText('Lỗi gần nhất')).closest('section')!;
    expect(within(block).getByText('embedding timeout')).toBeInTheDocument();
    await waitFor(() => expect(block).toHaveFocus());
  });

  it('offers error actions in the row menu only for failed documents', async () => {
    mocked.listDocuments.mockResolvedValue({ items: [doc('hutech'), doc('uel', { index_status: 'error' })], next_cursor: null });
    mocked.retryRevision.mockResolvedValue({} as never);
    renderPage();
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Thao tác cho HUTECH' }), { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: 'Xem chi tiết' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Chỉnh sửa' })).toHaveAttribute('href', '/admin/knowledge/kb1/documents/hutech');
    expect(screen.queryByRole('menuitem', { name: 'Xem lỗi' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    fireEvent.keyDown(screen.getByRole('button', { name: 'Thao tác cho UEL' }), { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: 'Xem lỗi' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Thử index lại' }));
    await waitFor(() => expect(mocked.retryRevision).toHaveBeenCalledWith({ kb: 'kb1', doc: 'uel', revision: 2 }));
  });

  it('maps the state filter from the URL to API params and offers to clear it', async () => {
    search = 'state=error&q=hu';
    mocked.listDocuments.mockResolvedValue({ items: [], next_cursor: null });
    renderPage();
    expect(await screen.findByText('Không tìm thấy tài liệu')).toBeInTheDocument();
    expect(mocked.listDocuments).toHaveBeenCalledWith('kb1', { q: 'hu', status: 'active', index_status: 'error', limit: 20 });
    fireEvent.click(screen.getByRole('button', { name: 'Xoá bộ lọc' }));
    expect(replace).toHaveBeenCalledWith('/admin/knowledge/kb1/documents', { scroll: false });
  });

  it('filters queued and in-progress indexing as separate states', async () => {
    mocked.listDocuments.mockResolvedValue({ items: [], next_cursor: null });
    search = 'state=pending';
    const { unmount } = renderPage();
    await waitFor(() => expect(mocked.listDocuments).toHaveBeenCalledWith('kb1', { status: 'active', index_status: 'pending', limit: 20 }));
    expect(screen.getByRole('combobox')).toHaveTextContent('Chờ xử lý');
    unmount();
    search = 'state=indexing';
    renderPage();
    await waitFor(() => expect(mocked.listDocuments).toHaveBeenCalledWith('kb1', { status: 'active', index_status: 'indexing', limit: 20 }));
    expect(screen.getByRole('combobox')).toHaveTextContent('Đang index');
  });
});
