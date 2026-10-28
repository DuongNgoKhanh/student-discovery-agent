import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }), usePathname: () => '/admin/agent' }));
vi.mock('../hooks/use-agent', () => ({
  useAgentDraft: () => ({ data: draft, isLoading: false, isError: false, isSuccess: true, status: 'success' }),
  useAgentActive: () => ({ data: { release_id: 'r', version: 1, content_hash: 'h0', revision: 1, updated_at: '2026-01-01T00:00:00Z', updated_by: 'admin' } }),
  useSaveDraft: () => ({ mutateAsync: save, isPending: false }),
  useValidateDraft: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/knowledge', async original => ({
  ...(await original<typeof import('@/features/knowledge')>()),
  useKnowledgeBases: () => ({ data: [] }),
  QueryState: ({ query, children }: { query: { data: unknown }; children: (d: never) => React.ReactNode }) => <>{children(query.data as never)}</>,
}));

describe('AgentPage', () => {
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
