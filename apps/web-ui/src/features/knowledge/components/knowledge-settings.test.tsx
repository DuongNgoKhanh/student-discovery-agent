import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProviders } from '@/test/render';
import { ApiError } from '@/lib/api/errors';
import { knowledgeApi } from '../api/knowledge';
import { KnowledgeSettings } from './knowledge-settings';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock('@/components/ui/sonner', () => ({ toast: { success: vi.fn() } }));
vi.mock('../api/knowledge', () => ({ knowledgeApi: { getBase: vi.fn(), patchBase: vi.fn(), agentParams: vi.fn(), deleteBase: vi.fn() } }));
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
    render(<TestProviders client={new QueryClient()}><KnowledgeSettings kb="kb1" /></TestProviders>);
    const description = await screen.findByLabelText('Mô tả');
    expect(screen.getByText('gemini-embedding-2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
    fireEvent.change(description, { target: { value: 'Mới' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(mocked.patchBase).toHaveBeenCalledWith({ kb: 'kb1', body: { description: 'Mới' } }));
    expect(screen.getByRole('heading', { name: 'Dùng cho agent' })).toBeInTheDocument();
  });

  it('copies each tool object on its own', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<TestProviders client={new QueryClient()}><KnowledgeSettings kb="kb1" /></TestProviders>);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy knowledge.show' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(JSON.parse(writeText.mock.calls[0]![0] as string)).toEqual({ display: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Copy knowledge.search' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(JSON.parse(writeText.mock.calls[1]![0] as string)).toEqual({ knowledge_base_id: 'kb1' });
    expect(screen.getByRole('link', { name: 'Gắn vào agent' })).toHaveAttribute('href', '/admin/agent?section=tools&kb=kb1');
  });

  const openDelete = async () => {
    render(<TestProviders client={new QueryClient()}><KnowledgeSettings kb="kb1" /></TestProviders>);
    fireEvent.click(await screen.findByRole('button', { name: 'Xoá knowledge base' }));
    return screen.findByLabelText(/Gõ chính xác tên/);
  };

  it('deletes only after typing the exact name, then goes back to the list', async () => {
    mocked.deleteBase.mockResolvedValue({ id: 'kb1', deleted: true });
    const input = await openDelete();
    const confirm = screen.getAllByRole('button', { name: 'Xoá knowledge base' }).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'tuyển sinh' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Tuyển sinh' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mocked.deleteBase).toHaveBeenCalledWith('kb1'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/knowledge'));
  });

  it('explains a 409 and links to the agent tools', async () => {
    mocked.deleteBase.mockRejectedValue(new ApiError({
      code: 'CONFLICT_RESOURCE_IN_USE', message: 'in use', httpStatus: 409, details: { kind: 'in_use', where: ['draft'] },
    }));
    const input = await openDelete();
    fireEvent.change(input, { target: { value: 'Tuyển sinh' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Xoá knowledge base' }).at(-1)!);
    expect(await screen.findByText('Knowledge base đang được agent dùng')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mở trang Agent' })).toHaveAttribute('href', '/admin/agent?section=tools');
    expect(push).not.toHaveBeenCalled();
  });
});
