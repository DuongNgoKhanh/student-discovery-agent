import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { WorkflowDebugRunResult } from '../types';
import { DebugTrace } from './debug-trace';

const result: WorkflowDebugRunResult = {
  run_id: 'dbg_test',
  status: 'completed',
  fallback_reason: null,
  path: ['start', 'condition', 'answer'],
  node_runs: [
    {
      node_id: 'condition',
      type: 'if_else',
      order: 2,
      handle: 'false',
      reason: { left: 'welcome', operator: '==', right: 'assessment', matched: false },
      input: { stage: 'welcome' },
      output: { matched: false },
      duration_ms: 12,
      llm_calls: 0,
      tokens: { input: 3, output: 4 },
      refs: ['kb:welcome'],
      error: null,
    },
  ],
  blocks: [{ type: 'text', text: 'Xin chào!' }],
  effects: [{ kind: 'assign_conv' }],
  llm_calls: 1,
  live_llm_calls: 1,
  tokens: { input: 10, output: 20 },
  created_at: '2026-11-18T00:00:00Z',
  expires_at: '2026-11-19T00:00:00Z',
};

describe('DebugTrace', () => {
  it('renders path, node details, branch reason, payloads, refs, and totals', () => {
    render(<DebugTrace result={result} />);

    expect(screen.getByLabelText('Đường đi workflow')).toHaveTextContent('start→condition→answer');
    expect(screen.getByLabelText('Node condition')).toHaveTextContent('condition');
    expect(screen.getByLabelText('Node condition')).toHaveTextContent('Handle: false');
    expect(screen.getByLabelText('Node condition')).toHaveTextContent('Lý do rẽ nhánh');
    expect(screen.getByLabelText('Node condition')).toHaveTextContent('assessment');
    expect(screen.getByLabelText('Node condition')).toHaveTextContent('Input');
    expect(screen.getByLabelText('Node condition')).toHaveTextContent('kb:welcome');
    expect(screen.getByLabelText('Tổng kết trace')).toHaveTextContent('Tokens input: 10');
    expect(screen.getByLabelText('Tổng kết trace')).toHaveTextContent('Live LLM calls: 1');
  });

  it('shows fallback reason, node errors, and expandable blocks/effects', () => {
    render(<DebugTrace result={{ ...result, status: 'fallback', fallback_reason: 'workflow_node_error', node_runs: [{ ...result.node_runs[0]!, error: 'timeout' }] }} />);

    expect(screen.getByRole('status')).toHaveTextContent('workflow_node_error');
    expect(screen.getByRole('alert')).toHaveTextContent('timeout');
    expect(screen.getByText('Blocks (1)')).toBeInTheDocument();
    expect(screen.getByText('Effects (dry-run) (1)')).toBeInTheDocument();
  });
});
