import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { knowledgeApi } from '../api/knowledge';
import { AgentTab } from './agent-tab';
import { tokenizeJson } from './json-code';

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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy cả hai' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Copy cả hai' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = JSON.parse(writeText.mock.calls[0]![0] as string);
    expect(copied).toEqual(params);
    expect(document.querySelectorAll('pre')).toHaveLength(2);
    for (const block of document.querySelectorAll('pre')) expect(block.textContent).not.toContain('warnings');
  });

  it('colours keys, strings, numbers and literals without changing the text', () => {
    const json = JSON.stringify({ a: 'x: "y"', b: -1.5, c: [true, null] }, null, 2);
    const tokens = tokenizeJson(json);
    expect(tokens.map(token => token.text).join('')).toBe(json);
    expect(tokens.filter(token => token.kind !== 'plain').map(token => `${token.kind}:${token.text}`)).toEqual([
      'key:"a"', 'string:"x: \\"y\\""', 'key:"b"', 'number:-1.5', 'key:"c"', 'literal:true', 'literal:null',
    ]);
  });
});
