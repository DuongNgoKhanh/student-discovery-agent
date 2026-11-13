import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { knowledgeApi } from '@/features/knowledge';
import { ApiError } from '@/lib/api/errors';
import { agentApi } from '../api/agent';
import type { AgentDraft } from '../types';
import { AgentPage } from './agent-page';

const draft: AgentDraft = {
  content: { greeting_text: 'Chào', tools: [{ name: 'a', version: 1, params: {} }] },
  revision: 1, content_hash: 'h1', updated_at: '2026-01-01T00:00:00Z', updated_by: 'admin',
};
const save = vi.fn(async ({ content }: { content: Record<string, unknown> }): Promise<AgentDraft> => ({
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
vi.mock('../api/agent', () => ({ agentApi: { getDraft: vi.fn() } }));
// Stand-in for the dialog: its own 409 handling is covered in publish-dialog.test.tsx; here only the page's reaction matters.
vi.mock('./publish-dialog', () => ({
  PublishDialog: ({ onConflict }: { onConflict?: () => void }) => <button type="button" onClick={onConflict}>Giả lập 409 khi phát hành</button>,
}));
vi.mock('@/features/knowledge', async original => ({
  ...(await original<typeof import('@/features/knowledge')>()),
  useKnowledgeBases: () => ({ data: [{ id: 'kb_x', name: 'KB X' }] }),
  knowledgeApi: { agentParams: vi.fn() },
}));

beforeEach(() => {
  search = new URLSearchParams();
  draftQuery = { data: draft, error: null, isLoading: false, isError: false, isSuccess: true, status: 'success' };
  save.mockClear();
  validateMock.mockClear();
});

describe('AgentPage', () => {
  it('switches to Chatflow and seeds a minimal workflow', async () => {
    render(<AgentPage />);
    fireEvent.click(screen.getByRole('radio', { name: 'Chatflow' }));
    expect(screen.getByRole('radio', { name: 'Chatflow' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Chatflow editor sẽ xuất hiện ở đây.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const sent = save.mock.calls[0]?.[0]?.content as Record<string, unknown>;
    expect(sent.mode).toBe('chatflow');
    expect(sent.workflow).toMatchObject({ entry: 'start' });
  });

  it('confirms before removing chatflow fields when switching back to Agent', async () => {
    draftQuery = { ...draftQuery, data: { ...draft, content: { ...draft.content, mode: 'chatflow', workflow: { entry: 'start', nodes: [], edges: [] }, persona_cases: [] } } };
    render(<AgentPage />);
    expect(screen.getByText('Chatflow editor sẽ xuất hiện ở đây.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Agent' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Đổi chế độ tác giả?');
    fireEvent.click(screen.getByRole('button', { name: 'Đổi chế độ' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Agent' })).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const sent = save.mock.calls[0]?.[0]?.content as Record<string, unknown>;
    expect(sent.mode).toBe('agent');
    expect(sent.workflow).toBeUndefined();
    expect(sent.persona_cases).toBeUndefined();
  });

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

  const server: AgentDraft = { ...draft, content: { ...draft.content, greeting_text: 'Bản trên server' }, revision: 3, content_hash: 'h3' };

  it('keeps my edits behind the conflict banner after a stale save, until I load the new copy', async () => {
    save.mockRejectedValueOnce(new ApiError({ code: 'CONFLICT_REVISION', message: 'x', httpStatus: 409, details: { current: server } }));
    render(<AgentPage />);
    fireEvent.change(screen.getByLabelText('Lời chào'), { target: { value: 'Của tôi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('revision 3');
    expect(screen.getByRole('alert')).toHaveTextContent('bởi admin');
    expect(screen.getByRole('alert')).toHaveTextContent(new Date(server.updated_at).toLocaleString('vi-VN'));
    expect(screen.getByLabelText('Lời chào')).toHaveValue('Của tôi');
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:agent-draft');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    let clicked: { download: string; attached: boolean } | null = null;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked = { download: this.download, attached: this.isConnected };
    });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Tải bản của tôi dạng JSON' }));
      expect(clicked).toEqual({ download: 'agent-draft.json', attached: true });
      const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
      // jsdom's Blob has no text().
      const text = await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsText(blob);
      });
      expect(JSON.parse(text)).toMatchObject({ greeting_text: 'Của tôi' });
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:agent-draft'));
    } finally {
      Reflect.deleteProperty(URL, 'createObjectURL');
      Reflect.deleteProperty(URL, 'revokeObjectURL');
      click.mockRestore();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Tải bản mới' }));
    expect(screen.getByLabelText('Lời chào')).toHaveValue('Bản trên server');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('turns the conflict actions off while the JSON editor is broken', async () => {
    save.mockRejectedValueOnce(new ApiError({ code: 'CONFLICT_REVISION', message: 'x', httpStatus: 409, details: { current: server } }));
    render(<AgentPage />);
    fireEvent.change(screen.getByLabelText('Lời chào'), { target: { value: 'Của tôi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    fireEvent.change(screen.getByLabelText('Cấu hình JSON'), { target: { value: '{ "greeting_text": ' } });
    expect(screen.getByRole('button', { name: 'Tải bản của tôi dạng JSON' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tải bản mới' })).toBeDisabled();
    expect(screen.getByText('Sửa lỗi JSON trước khi tải.')).toBeInTheDocument();
  });

  it('shows a section of the new mode when the loaded server copy changes the mode', async () => {
    const chatflowDraft: AgentDraft = { ...draft, content: { ...draft.content, mode: 'chatflow', workflow: { entry: 'start', nodes: [], edges: [] } } };
    draftQuery = { ...draftQuery, data: chatflowDraft };
    save.mockRejectedValueOnce(new ApiError({ code: 'CONFLICT_REVISION', message: 'x', httpStatus: 409, details: { current: { ...server, content: { ...server.content, mode: 'agent' } } } }));
    render(<AgentPage />);
    expect(screen.getByText('Chatflow editor sẽ xuất hiện ở đây.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    fireEvent.change(screen.getByLabelText('Workflow JSON'), { target: { value: JSON.stringify({ entry: 'start', nodes: [] }) } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Tải bản mới' }));
    expect(screen.getByRole('radio', { name: 'Agent' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByLabelText('Workflow JSON')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Lời chào')).toHaveValue('Bản trên server');
  });

  it('keeps the whole-config JSON section, where persona_cases is edited, in Chatflow mode', () => {
    draftQuery = { ...draftQuery, data: { ...draft, content: { ...draft.content, mode: 'chatflow', workflow: { entry: 'start', nodes: [], edges: [] } } } };
    render(<AgentPage />);
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(screen.getByLabelText('Cấu hình JSON')).toBeInTheDocument();
  });

  it('shows the banner instead of overwriting unsaved edits when publish hits a 409', async () => {
    vi.mocked(agentApi.getDraft).mockResolvedValue(server);
    render(<AgentPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Phát hành' }));
    fireEvent.change(screen.getByLabelText('Lời chào'), { target: { value: 'Chưa lưu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Giả lập 409 khi phát hành' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('revision 3');
    expect(screen.getByLabelText('Lời chào')).toHaveValue('Chưa lưu');
  });

  it('adopts the fresh draft silently when publish hits a 409 and nothing is unsaved', async () => {
    vi.mocked(agentApi.getDraft).mockResolvedValue(server);
    render(<AgentPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Phát hành' }));
    fireEvent.click(screen.getByRole('button', { name: 'Giả lập 409 khi phát hành' }));
    await waitFor(() => expect(screen.getByLabelText('Lời chào')).toHaveValue('Bản trên server'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('edits workflow in Chatflow JSON tab, blocks save/tabs while invalid, and persists across reload', async () => {
    const initialWorkflow = {
      entry: 'start',
      nodes: [{ id: 'start', type: 'start', title: 'Bắt đầu' }, { id: 'answer', type: 'answer', title: 'Trả lời', config: { text: 'Cũ' } }],
      edges: [{ id: 'e1', source: 'start', source_handle: 'next', target: 'answer' }],
    };
    const chatflowDraft: AgentDraft = {
      ...draft,
      content: { ...draft.content, mode: 'chatflow', workflow: initialWorkflow },
    };
    draftQuery = { ...draftQuery, data: chatflowDraft };

    const first = render(<AgentPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    const editor = screen.getByLabelText('Workflow JSON') as HTMLTextAreaElement;
    expect(JSON.parse(editor.value)).toEqual(initialWorkflow);

    fireEvent.change(editor, { target: { value: '{ "entry": ' } });
    expect(screen.getByRole('button', { name: 'Lưu nháp' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Kiểm tra' })).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Phiên bản' }));
    expect(screen.getByLabelText('Workflow JSON')).toBeInTheDocument();

    const editedWorkflow = {
      ...initialWorkflow,
      nodes: [initialWorkflow.nodes[0], { id: 'answer', type: 'answer', title: 'Trả lời', config: { text: 'Mới' } }],
    };
    const savedDraft: AgentDraft = {
      ...chatflowDraft,
      revision: 2,
      content_hash: 'h2',
      content: { ...chatflowDraft.content, workflow: editedWorkflow },
    };
    save.mockResolvedValueOnce(savedDraft);

    fireEvent.change(editor, { target: { value: JSON.stringify(editedWorkflow, null, 2) } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nháp' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect((save.mock.calls[0]?.[0]?.content as Record<string, unknown>).workflow).toEqual(editedWorkflow);

    first.unmount();
    draftQuery = { ...draftQuery, data: savedDraft };
    render(<AgentPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'JSON' }));
    expect(JSON.parse((screen.getByLabelText('Workflow JSON') as HTMLTextAreaElement).value)).toEqual(editedWorkflow);
  });
});
