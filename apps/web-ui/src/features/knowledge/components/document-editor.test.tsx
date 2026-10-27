import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { knowledgeApi } from '../api/knowledge';
import { DocumentEditor } from './document-editor';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('../api/knowledge', () => ({
  knowledgeApi: { listFields: vi.fn(), getDocument: vi.fn(), putDocument: vi.fn(), archiveDocument: vi.fn(), restoreDocument: vi.fn(), retryRevision: vi.fn() },
}));
const mocked = vi.mocked(knowledgeApi);

const renderEditor = (docId: string | null) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <DocumentEditor kb="kb1" docId={docId} />
  </QueryClientProvider>,
);

describe('DocumentEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.listFields.mockResolvedValue([
      { id: 'f1', name: 'houses', type: 'string_list', label: 'Hệ', filterable: true, ordinal: 0 },
    ]);
  });

  it('creates a document with typed metadata', async () => {
    mocked.putDocument.mockResolvedValue({ document_id: 'hutech', revision: 1, outcome: 'created' });
    renderEditor(null);
    fireEvent.change(await screen.findByLabelText('Document ID'), { target: { value: 'hutech' } });
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'HUTECH' } });
    fireEvent.change(screen.getByLabelText('Nội dung (Markdown)'), { target: { value: '# HUTECH' } });
    fireEvent.change(screen.getByLabelText('Hệ (houses)'), { target: { value: 'E; C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocked.putDocument).toHaveBeenCalledWith({
      kb: 'kb1', doc: 'hutech',
      body: { title: 'HUTECH', body: '# HUTECH', source_url: null, metadata: { houses: ['E', 'C'] }, expected_revision: 0 },
    }));
    expect(replace).toHaveBeenCalledWith('/admin/knowledge/kb1/documents/hutech');
  });

  it('never overwrites a document edited elsewhere', async () => {
    mocked.getDocument.mockResolvedValue({
      id: 'hutech', kb_id: 'kb1', status: 'active', revision: 1, updated_at: '2026-10-27T00:00:00Z', active: null,
      latest: { revision: 1, title: 'HUTECH', body: 'cũ', source_url: null, metadata: {}, index_status: 'ready', error: null, created_at: '2026-10-27T00:00:00Z' },
    });
    mocked.putDocument.mockRejectedValue(new ApiError({ code: 'CONFLICT_REVISION', message: 'Document revision conflict', httpStatus: 409 }));
    renderEditor('hutech');
    fireEvent.change(await screen.findByDisplayValue('cũ'), { target: { value: 'mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText(/đã bị sửa ở nơi khác/)).toBeInTheDocument();
    expect(mocked.putDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps typed text when the same revision is refetched with a new index status', async () => {
    const detail = (index_status: 'pending' | 'ready') => ({
      id: 'hutech', kb_id: 'kb1', status: 'active' as const, revision: 1, updated_at: '2026-10-27T00:00:00Z', active: null,
      latest: { revision: 1, title: 'HUTECH', body: 'cũ', source_url: null, metadata: {}, index_status, error: null, created_at: '2026-10-27T00:00:00Z' },
    });
    mocked.getDocument.mockResolvedValueOnce(detail('pending')).mockResolvedValue(detail('ready'));
    renderEditor('hutech');
    fireEvent.change(await screen.findByDisplayValue('cũ'), { target: { value: 'đang gõ dở' } });
    fireEvent.click(screen.getByRole('button', { name: 'Làm mới' }));
    await waitFor(() => expect(mocked.getDocument).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Sẵn sàng')).toBeInTheDocument());
    expect(screen.getByLabelText('Nội dung (Markdown)')).toHaveValue('đang gõ dở');
  });

  it('asks for another id when creating over an existing document', async () => {
    mocked.putDocument.mockRejectedValue(new ApiError({ code: 'CONFLICT_REVISION', message: 'Document revision conflict', httpStatus: 409 }));
    renderEditor(null);
    fireEvent.change(await screen.findByLabelText('Document ID'), { target: { value: 'hutech' } });
    fireEvent.change(screen.getByLabelText('Tiêu đề'), { target: { value: 'HUTECH' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Document ID đã tồn tại, hãy chọn ID khác.')).toBeInTheDocument();
    expect(screen.queryByText(/Tải bản mới/)).not.toBeInTheDocument();
  });
});
