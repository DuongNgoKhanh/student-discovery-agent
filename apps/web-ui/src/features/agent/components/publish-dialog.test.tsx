import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/errors';
import { agentApi } from '../api/agent';
import { PublishDialog } from './publish-dialog';

const draft = { content: { greeting_text: 'Mới', model: { ref: 'a' } }, revision: 4, content_hash: 'h2', updated_at: '', updated_by: 'admin' };
const active = { release_id: 'agr_1', version: 1, content_hash: 'h1', revision: 2, updated_at: '', updated_by: 'admin' };

vi.mock('../api/agent', () => ({ agentApi: { publish: vi.fn(), getRelease: vi.fn(), listReleases: vi.fn(async () => ({ items: [], next_cursor: null })) } }));

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe('PublishDialog', () => {
  it('shows changed groups, sends revisions and the note', async () => {
    vi.mocked(agentApi.getRelease).mockResolvedValue({ ...active, id: 'agr_1', content: { greeting_text: 'Cũ', model: { ref: 'a' } } } as never);
    vi.mocked(agentApi.publish).mockResolvedValue({ version: 2 } as never);
    wrap(<PublishDialog open onOpenChange={() => {}} draft={draft} active={active} onIssues={() => {}} />);
    expect(await screen.findByText('Lời chào & persona')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Ghi chú phát hành'), { target: { value: 'đổi lời chào' } });
    fireEvent.click(screen.getByRole('button', { name: 'Phát hành v2' }));
    await waitFor(() => expect(agentApi.publish).toHaveBeenCalledWith(expect.objectContaining({
      expected_draft_revision: 4, expected_active_revision: 2, note: 'đổi lời chào', idempotency_key: expect.stringMatching(/^publish-/),
    })));
  });

  it('names the next real version when an older release was restored', async () => {
    vi.mocked(agentApi.getRelease).mockResolvedValue({ content: {} } as never);
    vi.mocked(agentApi.listReleases).mockResolvedValueOnce({ items: [{ version: 3 }, { version: 2 }, { version: 1 }], next_cursor: null } as never);
    wrap(<PublishDialog open onOpenChange={() => {}} draft={draft} active={active} onIssues={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Phát hành v4' })).toBeInTheDocument();
    expect(screen.getByText('Phát hành v4', { selector: 'h2' })).toBeInTheDocument();
  });

  it('hands validation issues back to the editor', async () => {
    vi.mocked(agentApi.getRelease).mockResolvedValue({ content: {} } as never);
    vi.mocked(agentApi.publish).mockRejectedValue(new ApiError({ code: 'PUBLISH_GATE_FAILED', message: 'x', httpStatus: 422,
      details: { issues: [{ path: 'model.ref', code: 'value_error', message: 'Sai' }] } }));
    const onIssues = vi.fn();
    wrap(<PublishDialog open onOpenChange={() => {}} draft={draft} active={active} onIssues={onIssues} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Phát hành v2' }));
    await waitFor(() => expect(onIssues).toHaveBeenCalledWith([{ path: 'model.ref', code: 'value_error', message: 'Sai' }]));
  });

  it('reloads state and closes on a revision conflict', async () => {
    vi.mocked(agentApi.getRelease).mockResolvedValue({ content: {} } as never);
    vi.mocked(agentApi.publish).mockRejectedValue(new ApiError({ code: 'CONFLICT_REVISION', message: 'x', httpStatus: 409, details: { kind: 'revision_conflict' } }));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const onOpenChange = vi.fn();
    const onConflict = vi.fn();
    render(<QueryClientProvider client={client}><PublishDialog open onOpenChange={onOpenChange} draft={draft} active={active} onIssues={() => {}} onConflict={onConflict} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Phát hành v2' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agent'] });
    expect(onConflict).toHaveBeenCalled();
  });
});
