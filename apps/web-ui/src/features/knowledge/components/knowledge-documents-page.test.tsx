import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { knowledgeApi } from '../api/knowledge';
import type { DocumentSummary } from '../types';
import { KnowledgeDocumentsPage } from './knowledge-documents-page';

let search = '';
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace }),
  usePathname: () => '/admin/knowledge/kb1/documents',
}));
vi.mock('../api/knowledge', () => ({ knowledgeApi: { listDocuments: vi.fn(), archiveDocument: vi.fn(), restoreDocument: vi.fn(), retryRevision: vi.fn() } }));
const mocked = vi.mocked(knowledgeApi);

const doc = (id: string, patch: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id, status: 'active', revision: 2, title: id.toUpperCase(), index_status: 'ready', active_revision: 2, updated_at: '2026-10-27T00:00:00Z', ...patch,
});

const renderPage = () => renderWithProviders(<KnowledgeDocumentsPage kb="kb1" />);

describe('KnowledgeDocumentsPage', () => {
  beforeEach(() => { vi.resetAllMocks(); search = ''; });

  it('lists documents with their index status and confirms before turning one off', async () => {
    mocked.listDocuments.mockResolvedValue({
      items: [doc('hutech'), doc('uel', { index_status: 'error' }), doc('ftu', { status: 'archived' })], next_cursor: null,
    });
    mocked.archiveDocument.mockResolvedValue({} as never);
    renderPage();
    expect(await screen.findByRole('link', { name: 'HUTECH' })).toHaveAttribute('href', '/admin/knowledge/kb1/documents/hutech');
    expect(screen.getByText('Lỗi index')).toBeInTheDocument();
    // Archived rows keep their index status; the switch carries "off".
    expect(screen.getAllByText('Sẵn sàng')).toHaveLength(2);
    expect(screen.getByRole('switch', { name: 'Bật tài liệu FTU' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Thử lại' })).toBeInTheDocument();
    expect(mocked.listDocuments).toHaveBeenCalledWith('kb1', { limit: 20 });

    fireEvent.click(screen.getByRole('switch', { name: 'Bật tài liệu HUTECH' }));
    expect(await screen.findByText(/Agent sẽ không tìm thấy tài liệu này nữa/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tắt' }));
    await waitFor(() => expect(mocked.archiveDocument).toHaveBeenCalledWith({ kb: 'kb1', doc: 'hutech', expected_revision: 2 }));
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
