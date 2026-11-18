import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api/errors';
import { streamDebugRun, type DebugRunEvent } from '../api/debug-run';
import type { WorkflowDebugRunRequest, WorkflowDebugRunResult } from '../types';
import { DebugRunPanel } from './debug-run-panel';

vi.mock('../api/debug-run', () => ({ streamDebugRun: vi.fn() }));

const mockResult: WorkflowDebugRunResult = {
  run_id: 'dbg_0123456789abcdef01234567',
  status: 'completed',
  path: ['start', 'answer'],
  node_runs: [
    {
      node_id: 'start',
      type: 'start',
      order: 0,
      handle: 'next',
      duration_ms: 1,
      llm_calls: 0,
      tokens: { input: 0, output: 0 },
    },
    {
      node_id: 'answer',
      type: 'answer',
      order: 1,
      handle: null,
      duration_ms: 5,
      llm_calls: 1,
      tokens: { input: 10, output: 20 },
    },
  ],
  blocks: [],
  effects: [],
  llm_calls: 1,
  live_llm_calls: 1,
  tokens: { input: 10, output: 20 },
  created_at: '2026-11-18T00:00:00Z',
  expires_at: '2026-11-19T00:00:00Z',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('DebugRunPanel', () => {
  it('validates empty message and invalid JSON before calling the API', async () => {
    const streamMock = vi.mocked(streamDebugRun);
    render(<DebugRunPanel />);

    fireEvent.change(screen.getByLabelText('Nội dung input'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập message trước khi chạy');
    expect(streamMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Nội dung input'), { target: { value: 'học phí MTU' } });
    fireEvent.change(screen.getByLabelText('State giả lập'), { target: { value: '[]' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));
    expect(screen.getByRole('alert')).toHaveTextContent('State và LLM stubs phải là JSON object');
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('saves via beforeRun and streams node events, delta, and completed result', async () => {
    const beforeRun = vi.fn().mockResolvedValue(true);
    vi.mocked(streamDebugRun).mockImplementation(async function* (): AsyncGenerator<DebugRunEvent> {
      yield { event: 'workflow.node_started', node_id: 'start', type: 'start', order: 0 };
      yield { event: 'workflow.node_finished', node_id: 'start', handle: 'next', duration_ms: 1, llm_calls: 0 };
      yield { event: 'delta', text: 'Xin chào' };
      yield { event: 'completed', result: mockResult };
    });

    render(<DebugRunPanel beforeRun={beforeRun} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    await waitFor(() => {
      expect(screen.getByText('dbg_0123456789abcdef01234567')).toBeInTheDocument();
    });
    expect(beforeRun).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Tiến trình node')).toHaveTextContent('workflow.node_started · start');
    expect(screen.getByText('Xin chào')).toBeInTheDocument();
    expect(screen.getByText(/2 node · 1 live LLM/)).toBeInTheDocument();
  });

  it('stops before streaming when beforeRun returns false', async () => {
    const beforeRun = vi.fn().mockResolvedValue(false);
    const streamMock = vi.mocked(streamDebugRun);
    render(<DebugRunPanel beforeRun={beforeRun} />);

    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Không thể lưu bản nháp trước khi chạy thử');
    });
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('surfaces validation issues from ApiError details', async () => {
    vi.mocked(streamDebugRun).mockImplementation(async function* (): AsyncGenerator<DebugRunEvent> {
      throw new ApiError({
        code: 'VAL_INVALID_INPUT',
        message: 'Bản nháp chưa hợp lệ',
        httpStatus: 422,
        details: { issues: [{ path: 'workflow.nodes[0]', message: 'thiếu cạnh ra' }] },
      });
    });

    render(<DebugRunPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('workflow.nodes[0]: thiếu cạnh ra');
    });
  });

  it('aborts the active stream on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(streamDebugRun).mockImplementation(async function* (_req: WorkflowDebugRunRequest, signal?: AbortSignal): AsyncGenerator<DebugRunEvent> {
      capturedSignal = signal;
      await new Promise(() => {});
    });

    const { unmount } = render(<DebugRunPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    await waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});
