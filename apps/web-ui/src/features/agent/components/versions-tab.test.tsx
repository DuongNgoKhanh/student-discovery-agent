import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
});
