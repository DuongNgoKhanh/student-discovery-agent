import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ChatflowWorkflow } from '../types';
import { WorkflowJsonTab } from './workflow-json-tab';

const WORKFLOW: ChatflowWorkflow = {
  entry: 'start',
  nodes: [
    { id: 'start', type: 'start', title: 'Bắt đầu' },
    { id: 'answer', type: 'answer', title: 'Trả lời', config: { text: 'Xin chào' } },
  ],
  edges: [{ id: 'e1', source: 'start', source_handle: 'next', target: 'answer' }],
};

describe('WorkflowJsonTab', () => {
  it('renders formatted workflow JSON and propagates valid edits while preserving extra fields', () => {
    const onReplace = vi.fn();
    const onValidity = vi.fn();
    render(<WorkflowJsonTab workflow={WORKFLOW} onReplace={onReplace} onValidity={onValidity} />);

    const editor = screen.getByLabelText('Workflow JSON') as HTMLTextAreaElement;
    expect(editor.id).toBe('field-workflow');
    expect(JSON.parse(editor.value)).toEqual(WORKFLOW);

    const updated = { ...WORKFLOW, nodes: [WORKFLOW.nodes[0], { ...WORKFLOW.nodes[1], title: 'Phản hồi' }], extra_flag: true };
    fireEvent.change(editor, { target: { value: JSON.stringify(updated, null, 2) } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onValidity).toHaveBeenLastCalledWith(null);
    expect(onReplace).toHaveBeenLastCalledWith(updated);
  });

  it('reports invalid JSON syntax and non-object JSON without calling onReplace', () => {
    const onReplace = vi.fn();
    const onValidity = vi.fn();
    render(<WorkflowJsonTab workflow={WORKFLOW} onReplace={onReplace} onValidity={onValidity} />);

    const editor = screen.getByLabelText('Workflow JSON');
    fireEvent.change(editor, { target: { value: '{ "entry": ' } });
    expect(screen.getByRole('alert')).toHaveTextContent('JSON chưa hợp lệ');
    expect(onReplace).not.toHaveBeenCalled();
    expect(onValidity).toHaveBeenLastCalledWith(expect.stringContaining('JSON chưa hợp lệ'));

    fireEvent.change(editor, { target: { value: '[]' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Workflow phải là một JSON object');
    expect(onReplace).not.toHaveBeenCalled();
  });

  it('syncs external workflow updates when valid and clears validity on unmount', () => {
    const onReplace = vi.fn();
    const onValidity = vi.fn();
    const { rerender, unmount } = render(<WorkflowJsonTab workflow={WORKFLOW} onReplace={onReplace} onValidity={onValidity} />);

    const nextWorkflow: ChatflowWorkflow = { ...WORKFLOW, entry: 'start_v2' };
    rerender(<WorkflowJsonTab workflow={nextWorkflow} onReplace={onReplace} onValidity={onValidity} />);
    expect((screen.getByLabelText('Workflow JSON') as HTMLTextAreaElement).value).toContain('"start_v2"');

    fireEvent.change(screen.getByLabelText('Workflow JSON'), { target: { value: '{ broken' } });
    rerender(<WorkflowJsonTab workflow={{ ...WORKFLOW, entry: 'ignored_while_broken' }} onReplace={onReplace} onValidity={onValidity} />);
    expect((screen.getByLabelText('Workflow JSON') as HTMLTextAreaElement).value).toBe('{ broken');

    unmount();
    expect(onValidity).toHaveBeenLastCalledWith(null);
  });
});
