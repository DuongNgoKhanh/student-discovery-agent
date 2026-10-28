import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { knowledgeApi } from '@/features/knowledge';
import type { AgentDraft } from '../types';
import { AgentPage } from './agent-page';

const draft: AgentDraft = {
  content: { greeting_text: 'Chào', tools: [{ name: 'a', version: 1, params: {} }] },
  revision: 1, content_hash: 'h1', updated_at: '2026-01-01T00:00:00Z', updated_by: 'admin',
};
const save = vi.fn(async ({ content }: { content: Record<string, unknown> }) => ({
  ...draft, revision: 2, content_hash: 'h2',
  // jsonb returns keys in a different order than they were sent.
  content: { tools: [{ params: {}, version: 1, name: 'a' }], greeting_text: content.greeting_text },
}));

let search = new URLSearchParams();
type DraftQuery = { data?: AgentDraft; error: Error | null; isLoading: boolean; isError: boolean; isSuccess: boolean; status: string };
let draftQuery: DraftQuery = { data: draft, error: null, isLoading: false, isError: false, isSuccess: true, status: 'success' };
const validateMock = vi.fn();

vi.mock('next/navigation', () => ({ useSearchParams: () => search, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }), usePathname: () => '/admin/agent' }));
vi.mock('../hooks/use-agent', () => ({
  useAgentDraft: () => draftQuery,
  useAgentActive: () => ({ data: { release_id: 'r', version: 1, content_hash: 'h0', revision: 1, updated_at: '2026-01-01T00:00:00Z', updated_by: 'admin' } }),
  useSaveDraft: () => ({ mutateAsync: save, isPending: false }),
  useValidateDraft: () => ({ mutateAsync: validateMock, isPending: false }),
}));
vi.mock('@/features/knowledge', async original => ({
  ...(await original<typeof import('@/features/knowledge')>()),
  useKnowledgeBases: () => ({ data: [{ id: 'kb_x', name: 'KB X' }] }),
  knowledgeApi: { agentParams: vi.fn() },
}));

beforeEach(() => {
  search = new URLSearchParams();
  draftQuery = { data: draft, error: null, isLoading: false, isError: false, isSuccess: true, status: 'success' };
});

describe('AgentPage', () => {
  it('keeps the editor and unsaved edits when a background refetch fails', () => {
    const view = render(<AgentPage />);
    fireEvent.change(screen.getByLabelText('Lời chào'), { target: { value: 'Đang sửa' } });
    draftQuery = { ...draftQuery, error: new Error('mất mạng'), isError: true, isSuccess: false, status: 'error' };
    view.rerender(<AgentPage />);
    expect(screen.getByLabelText('Lời chào')).toHaveValue('Đang sửa');
    expect(screen.getByTestId('draft-state')).toHaveTextContent('Chưa lưu');
    expect(screen.getByRole('status')).toHaveTextContent('Không tải lại được bản nháp');
  });

  it('opens Tools and binds the knowledge base from ?section=tools&kb=', async () => {
    search = new URLSearchParams('section=tools&kb=kb_x');
    vi.mocked(knowledgeApi.agentParams).mockResolvedValue({
      'knowledge.search': { knowledge_base_id: 'kb_x', top_k: 4, auto_filter_fields: [] },
      'knowledge.show': { display: [{ field: 'school', label: 'Trường' }] }, warnings: [],
    } as never);
    render(<AgentPage />);
    expect(knowledgeApi.agentParams).toHaveBeenCalledWith('kb_x');
    await waitFor(() => expect(screen.getByLabelText('Bật Tìm trong Knowledge Base')).toBeChecked());
    expect(screen.getByLabelText('Knowledge base')).toHaveValue('kb_x');
  });

  it('marks a report for another draft revision as stale', async () => {
    validateMock.mockResolvedValueOnce({ valid: true, issues: [], content_hash: 'h1', draft_revision: 7 });
    render(<AgentPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }));
    expect(await screen.findByText(/Hết hiệu lực/)).toBeInTheDocument();
  });

  it('clears the unsaved state after a save whose response reorders keys', async () => {
    render(<AgentPage />);
    expect(screen.getByTestId('draft-state')).toHaveTextContent('Đã lưu – khác bản đang dùng');
    fireEvent.change(screen.getByLabelText('Lời chào'), { target: { value: 'Xin chào' } });
    expect(screen.getByTestId('draft-state')).toHaveTextContent('Chưa lưu');
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(screen.getByTestId('draft-state')).toHaveTextContent('Đã lưu – khác bản đang dùng'));
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Phát hành' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Lưu nháp' })).toBeDisabled();
  });
});
