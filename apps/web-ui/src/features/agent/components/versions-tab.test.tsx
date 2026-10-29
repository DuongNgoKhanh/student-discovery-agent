import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/errors';
import { agentApi } from '../api/agent';
import { VersionsTab } from './versions-tab';

vi.mock('../api/agent', () => ({ agentApi: { listReleases: vi.fn(), listAudit: vi.fn(), getRelease: vi.fn(), restore: vi.fn() } }));
const active = { release_id: 'agr_2', version: 2, content_hash: 'h2', revision: 3, updated_at: '2026-10-28T00:00:00Z', updated_by: 'admin' };
const row = (id: string, version: number, is_active: boolean) => ({ id, version, is_active, note: null, content_hash: 'h', draft_revision: 1, created_at: '2026-10-28T00:00:00Z', created_by: 'admin' });

describe('VersionsTab', () => {
  it('restores an older version after confirming the target', async () => {
    vi.mocked(agentApi.listReleases).mockResolvedValue({ items: [row('agr_2', 2, true), row('agr_1', 1, false)], next_cursor: null });
    vi.mocked(agentApi.listAudit).mockResolvedValue({ items: [], next_cursor: null });
    vi.mocked(agentApi.restore).mockResolvedValue({} as never);
    render(<QueryClientProvider client={new QueryClient()}><VersionsTab active={active} onCopyToDraft={() => {}} /></QueryClientProvider>);
    expect(await screen.findByText('Đang dùng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục v1' }));
    expect(screen.getByText(/Chuyển sang v1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục' }));
    await waitFor(() => expect(agentApi.restore).toHaveBeenCalledWith(expect.objectContaining({ id: 'agr_1', expected_active_revision: 3 })));
  });

  const setup = () => {
    vi.mocked(agentApi.listReleases).mockResolvedValue({ items: [row('agr_2', 2, true), row('agr_1', 1, false)], next_cursor: null });
    vi.mocked(agentApi.listAudit).mockResolvedValue({ items: [], next_cursor: null });
    const onCopy = vi.fn();
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><VersionsTab active={active} onCopyToDraft={onCopy} /></QueryClientProvider>);
    return { onCopy, client };
  };

  it('reuses the idempotency key when retrying the same restore', async () => {
    setup();
    vi.mocked(agentApi.restore).mockReset().mockRejectedValueOnce(new Error('network')).mockResolvedValue({} as never);
    fireEvent.click(await screen.findByRole('button', { name: 'Khôi phục v1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục' }));
    await waitFor(() => expect(agentApi.restore).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Khôi phục' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục' }));
    await waitFor(() => expect(agentApi.restore).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(agentApi.restore).mock.calls.map(c => c[0].idempotency_key);
    expect(first).toMatch(/^restore-/);
    expect(second).toBe(first);
  });

  it('invalidates and closes the confirm on a restore conflict', async () => {
    const { client } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.mocked(agentApi.restore).mockReset().mockRejectedValue(new ApiError({ code: 'CONFLICT_REVISION', message: 'x', httpStatus: 409, details: { kind: 'revision_conflict' } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Khôi phục v1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Khôi phục' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agent'] }));
    await waitFor(() => expect(screen.queryByText(/Chuyển sang v1/)).not.toBeInTheDocument());
  });

  it('copies the release content into the draft after confirming', async () => {
    const { onCopy } = setup();
    vi.mocked(agentApi.getRelease).mockResolvedValue({ ...row('agr_1', 1, false), content: { greeting_text: 'Cũ' } } as never);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Chép vào nháp' }))[1]!);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Chép vào nháp' }).at(-1)!).not.toBeDisabled());
    fireEvent.click(screen.getAllByRole('button', { name: 'Chép vào nháp' }).at(-1)!);
    await waitFor(() => expect(onCopy).toHaveBeenCalledWith({ greeting_text: 'Cũ' }));
  });
});
