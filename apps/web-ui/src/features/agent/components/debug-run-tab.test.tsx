import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api/errors';
import { streamDebugRun, type DebugRunEvent } from '../api/debug-run';
import type { ChatflowWorkflow, NodeTypeCatalog, WorkflowDebugRunRequest, WorkflowDebugRunResult } from '../types';
import { DebugRunTab, activeNode } from './debug-run-tab';

vi.mock('../api/debug-run', () => ({ streamDebugRun: vi.fn() }));

const workflow: ChatflowWorkflow = {
  entry: 'start',
  nodes: [
    { id: 'start', type: 'start', ui: { position: { x: 0, y: 0 } } },
    { id: 'answer', type: 'answer', ui: { position: { x: 240, y: 0 } } },
  ],
  edges: [{ id: 'e1', source: 'start', source_handle: 'next', target: 'answer' }],
};

const catalog: NodeTypeCatalog = {
  catalog_version: 'test',
  namespaces: [],
  node_types: [
    { type: 'start', title: 'Bắt đầu', description: 'Entry', config_schema: {}, handles: { static: ['next'] }, output_schema: {} },
    { type: 'answer', title: 'Trả lời', description: 'Answer', config_schema: {}, handles: { static: [] }, output_schema: {} },
  ],
};

const mockResult: WorkflowDebugRunResult = {
  run_id: 'dbg_0123456789abcdef01234567',
  status: 'completed',
  path: ['start', 'answer'],
  node_runs: [
    { node_id: 'start', type: 'start', order: 0, handle: 'next', duration_ms: 1, llm_calls: 0, tokens: { input: 0, output: 0 } },
    { node_id: 'answer', type: 'answer', order: 1, handle: null, duration_ms: 5, llm_calls: 1, tokens: { input: 10, output: 20 } },
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
  cleanup();
  vi.clearAllMocks();
});

describe('DebugRunTab', () => {
  it('streams node progress, highlights live path on canvas, and renders DebugTrace on completion', async () => {
    const beforeRun = vi.fn().mockResolvedValue(true);
    let releaseSecondNode!: () => void;
    const secondNodeGate = new Promise<void>(resolve => {
      releaseSecondNode = resolve;
    });

    vi.mocked(streamDebugRun).mockImplementation(async function* (): AsyncGenerator<DebugRunEvent> {
      yield { event: 'workflow.node_started', node_id: 'start', type: 'start', order: 0 };
      yield { event: 'workflow.node_finished', node_id: 'start', handle: 'next', duration_ms: 1, llm_calls: 0 };
      yield { event: 'workflow.node_started', node_id: 'answer', type: 'answer', order: 1 };
      await secondNodeGate;
      yield { event: 'workflow.node_finished', node_id: 'answer', handle: null, duration_ms: 5, llm_calls: 1 };
      yield { event: 'delta', text: 'Xin chào' };
      yield { event: 'completed', result: mockResult };
    });

    render(<DebugRunTab workflow={workflow} catalog={catalog} beforeRun={beforeRun} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Đường đi đang chạy')).toBeInTheDocument();
      expect(screen.getByTestId('workflow-node-answer').className).toContain('animate-pulse');
    });
    expect(screen.getByLabelText('Tiến trình node')).toHaveTextContent('workflow.node_started · start');

    releaseSecondNode();

    await waitFor(() => {
      expect(screen.getByLabelText('Trace chạy thử')).toBeInTheDocument();
    });
    expect(beforeRun).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Xin chào')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-node-answer').className).not.toContain('animate-pulse');
    expect(screen.getByTestId('workflow-node-answer').className).toContain('ring-primary/20');
  });

  it('stops before streaming when beforeRun returns false', async () => {
    const beforeRun = vi.fn().mockResolvedValue(false);
    const streamMock = vi.mocked(streamDebugRun);
    render(<DebugRunTab workflow={workflow} catalog={catalog} beforeRun={beforeRun} />);

    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Không thể lưu bản nháp trước khi chạy thử');
    });
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('reports a run whose stream ends without a completed frame', async () => {
    vi.mocked(streamDebugRun).mockImplementation(async function* (): AsyncGenerator<DebugRunEvent> {
      yield { event: 'workflow.node_started', node_id: 'start', type: 'start', order: 0 };
      yield { event: 'delta', text: 'Xin' };
    });

    render(<DebugRunTab workflow={workflow} catalog={catalog} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('bị ngắt giữa chừng');
    });
    expect(screen.queryByLabelText('Trace chạy thử')).not.toBeInTheDocument();
  });

  it('keeps deltas out of the node progress list', async () => {
    vi.mocked(streamDebugRun).mockImplementation(async function* (): AsyncGenerator<DebugRunEvent> {
      yield { event: 'workflow.node_started', node_id: 'start', type: 'start', order: 0 };
      yield { event: 'delta', text: 'Xin ' };
      yield { event: 'delta', text: 'chào' };
      yield { event: 'completed', result: mockResult };
    });

    render(<DebugRunTab workflow={workflow} catalog={catalog} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    await waitFor(() => expect(screen.getByLabelText('Trace chạy thử')).toBeInTheDocument());
    expect(screen.getByText('Xin chào')).toBeInTheDocument();
    expect(screen.getByLabelText('Tiến trình node').querySelectorAll('li')).toHaveLength(2);
  });

  it('warns on the trace when Studio could not store the run', async () => {
    vi.mocked(streamDebugRun).mockImplementation(async function* (): AsyncGenerator<DebugRunEvent> {
      yield { event: 'completed', result: mockResult };
      yield { event: 'run_not_saved', reason: 'store_failed' };
    });

    render(<DebugRunTab workflow={workflow} catalog={catalog} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    await waitFor(() => expect(screen.getByLabelText('Trace chạy thử')).toHaveTextContent('không được lưu (store_failed)'));
    expect(screen.getByLabelText('Trace chạy thử')).toHaveTextContent('(chưa lưu)');
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

    render(<DebugRunTab workflow={workflow} catalog={catalog} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('workflow.nodes[0]: thiếu cạnh ra');
    });
  });

  it('shows a 24-hour expiry message on RES_NOT_FOUND', async () => {
    vi.mocked(streamDebugRun).mockImplementation(async function* (): AsyncGenerator<DebugRunEvent> {
      throw new ApiError({
        code: 'RES_NOT_FOUND',
        message: 'Not found',
        httpStatus: 404,
      });
    });

    render(<DebugRunTab workflow={workflow} catalog={catalog} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Lần chạy thử đã hết hạn hoặc không còn tồn tại (thời gian lưu là 24 giờ).');
    });
  });

  it('aborts the active stream on unmount and shows fallback when workflow is missing', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(streamDebugRun).mockImplementation(async function* (_req: WorkflowDebugRunRequest, signal?: AbortSignal): AsyncGenerator<DebugRunEvent> {
      capturedSignal = signal;
      await new Promise(() => {});
    });

    const { unmount } = render(<DebugRunTab />);
    expect(screen.getByText('Workflow chưa có để chạy thử.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Chạy' }));
    await waitFor(() => expect(capturedSignal).toBeDefined());
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
});

describe('activeNode', () => {
  const started = (node_id: string, order: number): DebugRunEvent => ({ event: 'workflow.node_started', node_id, type: 'answer', order });
  const finished = (node_id: string): DebugRunEvent => ({ event: 'workflow.node_finished', node_id, handle: null, duration_ms: 1, llm_calls: 0 });

  it('points at the node started last, even when it was visited before', () => {
    expect(activeNode([started('a', 1), started('b', 2), started('a', 3)])).toBe('a');
  });

  it('closes one visit per finish, so a looping node stays active while it is still open', () => {
    expect(activeNode([started('a', 1), started('b', 2), started('a', 3), finished('a')])).toBe('b');
    expect(activeNode([started('a', 1), finished('a'), started('b', 2), finished('b'), started('a', 3)])).toBe('a');
    expect(activeNode([started('a', 1), finished('a')])).toBeNull();
  });
});
