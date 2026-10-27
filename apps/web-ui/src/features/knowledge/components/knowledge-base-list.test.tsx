import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { knowledgeApi } from '../api/knowledge';
import { KnowledgeBaseList } from './knowledge-base-list';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('../api/knowledge', () => ({ knowledgeApi: { listBases: vi.fn(), createBase: vi.fn() } }));
const mocked = vi.mocked(knowledgeApi);

const kb = (id: string, name: string, patch = {}) => ({
  id, name, description: '', embedding_model: 'gemini-embedding-2', document_count: 8, error_count: 0,
  created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z', ...patch,
});

const renderList = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <KnowledgeBaseList />
  </QueryClientProvider>,
);

describe('KnowledgeBaseList', () => {
  beforeEach(() => vi.resetAllMocks());

  it('shows a card per knowledge base and filters them', async () => {
    mocked.listBases.mockResolvedValue([kb('tuyen-sinh', 'Tuyển sinh', { error_count: 2 }), kb('hoc-bong', 'Học bổng')]);
    renderList();
    const card = await screen.findByRole('link', { name: /Tuyển sinh/ });
    expect(card).toHaveAttribute('href', '/admin/knowledge/tuyen-sinh/documents');
    expect(card).toHaveTextContent('2 lỗi index');
    fireEvent.change(screen.getByLabelText('Tìm knowledge base'), { target: { value: 'học' } });
    expect(screen.queryByRole('link', { name: /Tuyển sinh/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Học bổng/ })).toBeInTheDocument();
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
