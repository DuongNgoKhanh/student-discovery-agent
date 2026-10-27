import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { knowledgeApi } from '../api/knowledge';
import { KnowledgeSettings } from './knowledge-settings';

vi.mock('../api/knowledge', () => ({ knowledgeApi: { getBase: vi.fn(), patchBase: vi.fn(), agentParams: vi.fn() } }));
const mocked = vi.mocked(knowledgeApi);
const base = {
  id: 'kb1', name: 'Tuyển sinh', description: 'Cũ', embedding_model: 'gemini-embedding-2', document_count: 1, error_count: 0,
  created_at: '2026-10-27T00:00:00Z', updated_at: '2026-10-27T00:00:00Z',
};

describe('KnowledgeSettings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.getBase.mockResolvedValue(base);
    mocked.agentParams.mockResolvedValue({ 'knowledge.search': { knowledge_base_id: 'kb1' }, 'knowledge.show': { display: [] }, warnings: [] } as never);
  });

  it('saves only the changed fields once the form is dirty', async () => {
    mocked.patchBase.mockResolvedValue({ ...base, description: 'Mới' });
    render(<QueryClientProvider client={new QueryClient()}><KnowledgeSettings kb="kb1" /></QueryClientProvider>);
    const description = await screen.findByLabelText('Mô tả');
    expect(screen.getByText('gemini-embedding-2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    fireEvent.change(description, { target: { value: 'Mới' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocked.patchBase).toHaveBeenCalledWith({ kb: 'kb1', body: { description: 'Mới' } }));
    expect(screen.getByRole('heading', { name: 'Dùng cho agent' })).toBeInTheDocument();
  });
});
