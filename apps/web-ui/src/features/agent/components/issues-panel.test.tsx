import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChatflowWorkflow } from '../types';
import { IssuesPanel, type ValidationState } from './issues-panel';

const workflow: ChatflowWorkflow = {
  entry: 'start',
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'classify', type: 'if_else', config: { labels: ['hoc_phi', 'tuyen_sinh'] } },
  ],
  edges: [{ id: 'e1', source: 'start', source_handle: 'next', target: 'classify' }],
};

const state: ValidationState = {
  valid: false,
  stale: false,
  checkedAt: '2026-01-01T00:00:00Z',
  issues: [
    { path: 'workflow.nodes[1].config.labels[0]', code: 'workflow_unwired_label', message: 'Nhãn chưa nối' },
    { path: 'workflow.nodes[1].config.labels[1]', code: 'workflow_unwired_label', message: 'Nhãn thứ hai chưa nối' },
  ],
};

afterEach(() => {
  cleanup();
  document.getElementById('field-workflow')?.remove();
});

describe('IssuesPanel', () => {
  it('groups workflow issues by node and highlights the JSON property on click', async () => {
    const onOpenSection = vi.fn();
    const onOpenWorkflowIssue = vi.fn();
    render(<IssuesPanel state={state} workflow={workflow} onOpenSection={onOpenSection} onOpenWorkflowIssue={onOpenWorkflowIssue} />);

    expect(screen.getAllByText('node classify')).toHaveLength(1);
    const editor = document.createElement('textarea');
    editor.id = 'field-workflow';
    editor.value = JSON.stringify(workflow, null, 2);
    document.body.appendChild(editor);

    fireEvent.click(screen.getByRole('button', { name: /Nhãn chưa nối/ }));

    expect(onOpenSection).toHaveBeenCalledWith('chatflow');
    expect(onOpenWorkflowIssue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'node', nodeId: 'classify', configPath: ['labels', 0] }),
      state.issues[0],
    );
    await waitFor(() => expect(editor.selectionStart).toBeGreaterThan(0));
    expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toContain('"labels"');
  });

  it('falls back to "toàn bộ workflow" for unknown paths and shows stale status', () => {
    const onOpenSection = vi.fn();
    render(
      <IssuesPanel
        state={{ ...state, stale: true, issues: [{ path: 'workflow.nodes[9]', code: 'workflow', message: 'Node không tồn tại' }] }}
        workflow={workflow}
        onOpenSection={onOpenSection}
      />,
    );
    expect(screen.getByText(/Hết hiệu lực/)).toBeInTheDocument();
    expect(screen.getByText('toàn bộ workflow')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Node không tồn tại/ }));
    expect(onOpenSection).toHaveBeenCalledWith('chatflow');
  });
});
