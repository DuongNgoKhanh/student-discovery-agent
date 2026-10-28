import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { agentApi } from '../api/agent';
import { AuditList } from './audit-list';

vi.mock('../api/agent', () => ({ agentApi: { listAudit: vi.fn(), listReleases: vi.fn() } }));
const ev = (id: string, o: object) => ({ id, at: '2026-10-28T00:00:00Z', actor: 'admin', action: 'agent.release.restore', before_ref: null, after_ref: null, outcome: 'success', details: {}, ...o });

describe('AuditList', () => {
  it('shows before to after and the outcome', async () => {
    vi.mocked(agentApi.listReleases).mockResolvedValue({ items: [{ id: 'agr_2', version: 2 }, { id: 'agr_1', version: 1 }] as never, next_cursor: null });
    vi.mocked(agentApi.listAudit).mockResolvedValue({ items: [
      ev('a', { before_ref: 'agr_2', after_ref: 'agr_1', details: { version: 1 } }),
      ev('b', { action: 'agent.draft.save', before_ref: 'draft@3', after_ref: 'draft@4', outcome: 'rejected' }),
    ] as never, next_cursor: null });
    render(<QueryClientProvider client={new QueryClient()}><AuditList /></QueryClientProvider>);
    expect(await screen.findByText(/v2 → v1/)).toBeInTheDocument();
    expect(screen.getByText(/draft@3 → draft@4/)).toBeInTheDocument();
    expect(screen.getByText('Thành công')).toBeInTheDocument();
    expect(screen.getByText('Bị từ chối')).toBeInTheDocument();
  });
});
