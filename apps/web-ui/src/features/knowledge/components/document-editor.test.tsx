import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api/errors';
import { knowledgeApi } from '../api/knowledge';
import type { DocumentDetail, IndexStatus } from '../types';
import { DocumentEditor } from './document-editor';

const replace = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push }) }));
vi.mock('@/components/ui/sonner', () => ({ toast: { success: vi.fn() } }));
vi.mock('../api/knowledge', () => ({
  knowledgeApi: { listFields: vi.fn(), getDocument: vi.fn(), putDocument: vi.fn(), archiveDocument: vi.fn(), restoreDocument: vi.fn(), retryRevision: vi.fn() },
}));
const mocked = vi.mocked(knowledgeApi);

const renderEditor = (docId: string | null) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><DocumentEditor kb="kb1" docId={docId} /></QueryClientProvider>);
  return client;
};

const detail = (revision: number, index_status: IndexStatus, body = 'cũ'): DocumentDetail => ({
  id: 'hutech', kb_id: 'kb1', status: 'active', revision, updated_at: '2026-10-27T00:00:00Z', active: null,
  latest: { revision, title: 'HUTECH', body, source_url: null, metadata: {}, index_status, error: null, created_at: '2026-10-27T00:00:00Z' },
});
const conflictError = () => new ApiError({ code: 'CONFLICT_REVISION', message: 'Document revision conflict', httpStatus: 409 });

describe('DocumentEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.listFields.mockResolvedValue([
      { id: 'f1', name: 'houses', type: 'string_list', label: 'Hệ', filterable: true, ordinal: 0 },
    ]);
  });

  it('creates a document with an ID from the title and typed metadata', async () => {
    mocked.putDocument.mockResolvedValue({ document_id: 'hutech', revision: 1, outcome: 'created' });
    renderEditor(null);
    fireEvent.change(await screen.findByLabelText('Tiêu đề'), { target: { value: 'HUTECH' } });
    expect(screen.getByText('ID: hutech')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nội dung (Markdown)'), { target: { value: '# HUTECH' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hệ: chưa có' }));
    const tags = screen.getByLabelText('Hệ');
    fireEvent.change(tags, { target: { value: 'E' } });
    fireEvent.keyDown(tags, { key: 'Enter' });
    fireEvent.change(tags, { target: { value: 'C;' } });
    expect(screen.getByText('Chưa lưu')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocked.putDocument).toHaveBeenCalledWith({
      kb: 'kb1', doc: 'hutech',
      body: { title: 'HUTECH', body: '# HUTECH', source_url: null, metadata: { houses: ['E', 'C'] }, expected_revision: 0 },
    }));
    expect(replace).toHaveBeenCalledWith('/admin/knowledge/kb1/documents/hutech');
    expect(toast.success).toHaveBeenCalledWith('Đã lưu r1');
  });

  it('never overwrites a document edited elsewhere', async () => {
    mocked.getDocument.mockResolvedValue(detail(1, 'ready'));
    mocked.putDocument.mockRejectedValue(conflictError());
    renderEditor('hutech');
    fireEvent.change(await screen.findByDisplayValue('cũ'), { target: { value: 'mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText(/đã bị sửa ở nơi khác/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy nội dung của tôi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải bản mới (bỏ nội dung đang soạn)' })).toBeInTheDocument();
    expect(mocked.putDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps typed text when the same revision is refetched with a new index status', async () => {
    mocked.getDocument.mockResolvedValueOnce(detail(1, 'pending')).mockResolvedValue(detail(1, 'ready'));
    const client = renderEditor('hutech');
    fireEvent.change(await screen.findByDisplayValue('cũ'), { target: { value: 'đang gõ dở' } });
    await client.invalidateQueries();
    await waitFor(() => expect(mocked.getDocument).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Sẵn sàng')).toBeInTheDocument());
    expect(screen.getByLabelText('Nội dung (Markdown)')).toHaveValue('đang gõ dở');
  });

  it('keeps unsaved edits over a newer revision and saves against the revision they started from', async () => {
    mocked.getDocument.mockResolvedValueOnce(detail(1, 'ready')).mockResolvedValue(detail(2, 'pending', 'bản khác'));
    mocked.putDocument.mockRejectedValue(conflictError());
    const client = renderEditor('hutech');
    fireEvent.change(await screen.findByDisplayValue('cũ'), { target: { value: 'đang gõ dở' } });
    await client.invalidateQueries();
    await waitFor(() => expect(screen.getByText('Đang index')).toBeInTheDocument());
    expect(screen.getByLabelText('Nội dung (Markdown)')).toHaveValue('đang gõ dở');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocked.putDocument).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ expected_revision: 1 }),
    })));
  });

  it('asks for another id when creating over an existing document', async () => {
    mocked.putDocument.mockRejectedValue(conflictError());
    renderEditor(null);
    fireEvent.change(await screen.findByLabelText('Tiêu đề'), { target: { value: 'HUTECH' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('ID đã tồn tại, hãy chọn ID khác.')).toBeInTheDocument();
    expect(screen.getByLabelText('ID tài liệu')).toHaveValue('hutech');
    expect(screen.queryByText(/Tải bản mới/)).not.toBeInTheDocument();
  });

  it('puts 422 issues under their fields and focuses the error summary', async () => {
    mocked.getDocument.mockResolvedValue(detail(1, 'ready'));
    mocked.putDocument.mockRejectedValue(new ApiError({
      code: 'VAL_INVALID_INPUT', message: 'Invalid metadata', httpStatus: 422,
      details: { kind: 'validation', issues: [{ path: 'metadata.houses', message: 'Expected string_list' }] },
    }));
    renderEditor('hutech');
    fireEvent.change(await screen.findByDisplayValue('cũ'), { target: { value: 'mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    const message = 'Giá trị không hợp lệ (Expected string_list).';
    const inline = await screen.findByText(message);
    expect(screen.getByRole('button', { name: 'Hệ: chưa có' })).toHaveAttribute('aria-describedby', inline.id);
    await waitFor(() => expect(screen.getByText(/Chưa lưu được/).closest('[tabindex="-1"]')).toHaveFocus());
    expect(screen.getByText(`Hệ: ${message}`)).toBeInTheDocument();
  });

  it('blocks saving a body over 256 KB', async () => {
    renderEditor(null);
    fireEvent.change(await screen.findByLabelText('Tiêu đề'), { target: { value: 'HUTECH' } });
    fireEvent.change(screen.getByLabelText('Nội dung (Markdown)'), { target: { value: 'a'.repeat(262_145) } });
    expect(screen.getByText('256 / 256 KB')).toHaveClass('text-destructive');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Nội dung: Nội dung vượt quá 256 KB, hãy chia nhỏ tài liệu.')).toBeInTheDocument();
    expect(mocked.putDocument).not.toHaveBeenCalled();
  });

  it('confirms before following the back link with unsaved edits', async () => {
    mocked.getDocument.mockResolvedValue(detail(1, 'ready'));
    renderEditor('hutech');
    fireEvent.change(await screen.findByDisplayValue('cũ'), { target: { value: 'mới' } });
    fireEvent.click(screen.getByRole('link', { name: 'Tài liệu' }));
    expect(await screen.findByText('Rời trang khi chưa lưu?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rời trang' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/knowledge/kb1/documents'));
  });
});
