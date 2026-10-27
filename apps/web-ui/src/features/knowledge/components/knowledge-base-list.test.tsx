import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { knowledgeApi } from '../api/knowledge';
import { KnowledgeBaseList } from './knowledge-base-list';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('../api/knowledge', () => ({ knowledgeApi: { listBases: vi.fn(), createBase: vi.fn(), patchBase: vi.fn() } }));
const mocked = vi.mocked(knowledgeApi);

const kb = (id: string, name: string, patch = {}) => ({
  id, name, description: '', embedding_model: 'gemini-embedding-2', document_count: 8, error_count: 0,
  created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z', ...patch,
});

const renderList = () => renderWithProviders(<KnowledgeBaseList />);

describe('KnowledgeBaseList', () => {
  beforeEach(() => vi.resetAllMocks());

  it('shows a card per knowledge base, links index errors and filters them', async () => {
    mocked.listBases.mockResolvedValue([kb('tuyen-sinh', 'Tuyển sinh', { error_count: 2 }), kb('hoc-bong', 'Học bổng')]);
    renderList();
    expect(await screen.findByRole('link', { name: 'Tuyển sinh' })).toHaveAttribute('href', '/admin/knowledge/tuyen-sinh/documents');
    expect(screen.getByRole('link', { name: /2 tài liệu lỗi index/ })).toHaveAttribute('href', '/admin/knowledge/tuyen-sinh/documents?state=error');
    expect(screen.getAllByText('8 tài liệu')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Tìm knowledge base'), { target: { value: 'học' } });
    expect(screen.queryByRole('link', { name: 'Tuyển sinh' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Học bổng' })).toBeInTheDocument();
  });

  it('renames a knowledge base from the card menu', async () => {
    mocked.listBases.mockResolvedValue([kb('tuyen-sinh', 'Tuyển sinh')]);
    mocked.patchBase.mockResolvedValue(kb('tuyen-sinh', 'Tuyển sinh 2027'));
    renderList();
    const menu = await screen.findByRole('button', { name: 'Thao tác cho Tuyển sinh' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Đổi tên' }));
    const dialog = await screen.findByRole('dialog', { name: 'Đổi tên knowledge base' });
    const input = within(dialog).getByLabelText('Tên');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    expect(await within(dialog).findByText('Nhập tên knowledge base.')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Tuyển sinh 2027' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocked.patchBase).toHaveBeenCalledWith({ kb: 'tuyen-sinh', body: { name: 'Tuyển sinh 2027' } }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('creates a knowledge base from the dialog and opens it', async () => {
    mocked.listBases.mockResolvedValue([]);
    mocked.createBase.mockResolvedValue(kb('kb-moi', 'KB mới'));
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: /Tạo knowledge base/ }));
    fireEvent.change(screen.getByLabelText('Tên'), { target: { value: 'KB mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(mocked.createBase).toHaveBeenCalledWith({ name: 'KB mới', embedding_model: 'gemini-embedding-2' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/knowledge/kb-moi/documents'));
  });
});
