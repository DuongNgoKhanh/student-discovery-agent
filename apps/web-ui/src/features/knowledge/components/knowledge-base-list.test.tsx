import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { knowledgeApi } from '../api/knowledge';
import { KnowledgeBaseList } from './knowledge-base-list';

vi.mock('../api/knowledge', () => ({ knowledgeApi: { listBases: vi.fn(), createBase: vi.fn() } }));
const mocked = vi.mocked(knowledgeApi);

const renderList = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <KnowledgeBaseList />
  </QueryClientProvider>,
);

describe('KnowledgeBaseList', () => {
  beforeEach(() => vi.resetAllMocks());

  it('lists knowledge bases and creates one', async () => {
    mocked.listBases.mockResolvedValue([{
      id: 'tuyen-sinh', name: 'Tuyển sinh', description: '', embedding_model: 'gemini-embedding-2',
      document_count: 8, error_count: 1, created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z',
    }]);
    mocked.createBase.mockResolvedValue({} as never);
    renderList();
    expect(await screen.findByRole('link', { name: 'Tuyển sinh' })).toHaveAttribute('href', '/admin/knowledge/tuyen-sinh');
    fireEvent.change(screen.getByPlaceholderText('Tên'), { target: { value: 'KB mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tạo' }));
    await waitFor(() => expect(mocked.createBase).toHaveBeenCalledWith({ name: 'KB mới', embedding_model: 'gemini-embedding-2' }));
  });
});
