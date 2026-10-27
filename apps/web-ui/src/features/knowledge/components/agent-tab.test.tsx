import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { knowledgeApi } from '../api/knowledge';
import { AgentTab } from './agent-tab';

vi.mock('../api/knowledge', () => ({ knowledgeApi: { agentParams: vi.fn() } }));
const mocked = vi.mocked(knowledgeApi);
const params = {
  'knowledge.search': { knowledge_base_id: 'kb1', top_k: 4, auto_filter_fields: ['major'] },
  'knowledge.show': { display: [{ field: 'major', label: 'Ngành' }] },
};

describe('AgentTab', () => {
  beforeEach(() => vi.resetAllMocks());

  it('shows warnings above the JSON and copies only the two param objects', async () => {
    mocked.agentParams.mockResolvedValue({ ...params, warnings: ['Chỉ hiển thị 8 field đầu tiên theo thứ tự.'] });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<QueryClientProvider client={new QueryClient()}><AgentTab kb="kb1" /></QueryClientProvider>);

    expect(await screen.findByText('Chỉ hiển thị 8 field đầu tiên theo thứ tự.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = JSON.parse(writeText.mock.calls[0]![0] as string);
    expect(copied).toEqual(params);
    expect(screen.getByText(/"knowledge.show"/).textContent).not.toContain('warnings');
  });
});
