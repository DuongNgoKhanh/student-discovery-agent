import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_WORKFLOW_NODES } from '../model/workflow/edit';
import type { AgentIssue, ChatflowWorkflow, NodeTypeCatalog } from '../types';
import { NodePalette, WORKFLOW_PALETTE_MIME } from './node-palette';
import {
  connectWorkflowNodes,
  createNodeFromCatalog,
  isValidWorkflowConnection,
  moveWorkflowNode,
  WorkflowCanvas,
  workflowCanvasTargets,
} from './workflow-canvas';

const workflow: ChatflowWorkflow = {
  entry: 'start',
  nodes: [
    { id: 'start', type: 'start', ui: { position: { x: 10, y: 20 } } },
    { id: 'classify', type: 'intent_classifier', config: { labels: [{ id: 'study' }, { id: 'other' }] } },
    { id: 'answer', type: 'answer' },
  ],
  edges: [
    { id: 'e1', source: 'start', source_handle: 'next', target: 'classify' },
    { id: 'e2', source: 'classify', source_handle: 'study', target: 'answer' },
  ],
};

const catalog: NodeTypeCatalog = {
  catalog_version: 'test',
  namespaces: [],
  node_types: [
    { type: 'start', title: 'Bắt đầu', description: 'Entry', config_schema: {}, handles: { static: ['next'] }, output_schema: {} },
    {
      type: 'if_else',
      title: 'Rẽ nhánh',
      description: 'Branch',
      config_schema: {
        type: 'object',
        properties: { condition: { type: 'object' } },
      },
      handles: { static: ['true', 'false'] },
      output_schema: {},
    },
    { type: 'intent_classifier', title: 'Phân loại', description: 'Classifies', config_schema: {}, handles: { static: [], from_config: { array: 'labels', id_field: 'id' } }, output_schema: {} },
    {
      type: 'answer',
      title: 'Trả lời',
      description: 'Answer',
      config_schema: {
        type: 'object',
        properties: {
          text: { type: 'string', default: '' },
          blocks: { type: 'array', default: [] },
        },
      },
      handles: { static: [] },
      output_schema: {},
    },
  ],
};

const issues: AgentIssue[] = [
  { path: 'workflow.nodes[1].config.labels[0]', code: 'workflow_unwired_label', message: 'Nhãn chưa nối' },
  { path: 'workflow.edges[1]', code: 'workflow_invalid_edge', message: 'Cạnh lỗi' },
];

afterEach(cleanup);

describe('WorkflowCanvas', () => {
  it('maps node and edge issues to their canvas targets', () => {
    expect(workflowCanvasTargets(workflow, issues)).toEqual([
      expect.objectContaining({ kind: 'node', nodeId: 'classify' }),
      expect.objectContaining({ kind: 'edge', edgeId: 'e2' }),
    ]);
  });

  it('renders catalog labels, generated handles, and issue styling in read-only mode', () => {
    render(<WorkflowCanvas workflow={workflow} catalog={catalog} issues={issues} />);

    expect(screen.getByTestId('workflow-canvas')).toBeInTheDocument();
    expect(screen.getByText('Bắt đầu')).toBeInTheDocument();
    expect(screen.getByText('Phân loại')).toBeInTheDocument();
    expect(screen.getByText('study')).toBeInTheDocument();
    expect(screen.getByText('other')).toBeInTheDocument();
    expect(screen.queryByText('Nhãn chưa nối')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workflow-node-palette')).not.toBeInTheDocument();
    expect(screen.queryByTestId('delete-node-classify')).not.toBeInTheDocument();
  });

  it('connects true and false handles of an if_else node to distinct targets (AT #1)', () => {
    const branchWorkflow: ChatflowWorkflow = {
      entry: 'start',
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'branch', type: 'if_else', config: { condition: {} } },
        { id: 'answer_yes', type: 'answer' },
        { id: 'answer_no', type: 'answer' },
      ],
      edges: [{ id: 'e_start', source: 'start', source_handle: 'next', target: 'branch' }],
    };

    const withTrue = connectWorkflowNodes(branchWorkflow, {
      source: 'branch',
      sourceHandle: 'true',
      target: 'answer_yes',
    });
    const withBoth = connectWorkflowNodes(withTrue, {
      source: 'branch',
      sourceHandle: 'false',
      target: 'answer_no',
    });

    expect(withBoth.edges).toHaveLength(3);
    expect(withBoth.edges?.slice(1)).toEqual([
      {
        id: expect.stringMatching(/^e_branch_true_/),
        source: 'branch',
        source_handle: 'true',
        target: 'answer_yes',
      },
      {
        id: expect.stringMatching(/^e_branch_false_/),
        source: 'branch',
        source_handle: 'false',
        target: 'answer_no',
      },
    ]);
    for (const edge of withBoth.edges ?? []) {
      expect(Object.keys(edge).sort()).toEqual(['id', 'source', 'source_handle', 'target']);
    }
  });

  it('rejects self-loops, edges into start, and ancestor edges that form cycles (AT #2)', () => {
    expect(
      isValidWorkflowConnection(workflow, {
        source: 'classify',
        sourceHandle: 'other',
        target: 'classify',
      }),
    ).toBe(false);
    expect(
      isValidWorkflowConnection(workflow, {
        source: 'classify',
        sourceHandle: 'other',
        target: 'start',
      }),
    ).toBe(false);
    expect(
      isValidWorkflowConnection(workflow, {
        source: 'answer',
        sourceHandle: 'next',
        target: 'classify',
      }),
    ).toBe(false);
    expect(
      isValidWorkflowConnection(workflow, {
        source: 'answer',
        sourceHandle: 'next',
        target: 'start',
      }),
    ).toBe(false);

    expect(
      connectWorkflowNodes(workflow, {
        source: 'answer',
        sourceHandle: 'next',
        target: 'classify',
      }),
    ).toBe(workflow);
  });

  it('updates ui.position on move and reflects external JSON position updates on the canvas (AT #4)', () => {
    const moved = moveWorkflowNode(workflow, 'classify', { x: 420, y: 180 });
    expect(moved.nodes.find((node) => node.id === 'classify')?.ui?.position).toEqual({ x: 420, y: 180 });
    expect(moved.edges).toEqual(workflow.edges);
    expect(JSON.stringify(moved)).not.toBe(JSON.stringify(workflow));

    const { rerender } = render(
      <WorkflowCanvas workflow={workflow} catalog={catalog} onChange={vi.fn()} />,
    );
    expect(screen.getByTestId('workflow-node-start')).toHaveAttribute('data-position', '10,20');

    const jsonEdited: ChatflowWorkflow = {
      ...workflow,
      nodes: workflow.nodes.map((node) =>
        node.id === 'start' ? { ...node, ui: { position: { x: 300, y: 260 } } } : node,
      ),
    };
    rerender(<WorkflowCanvas workflow={jsonEdited} catalog={catalog} onChange={vi.fn()} />);
    expect(screen.getByTestId('workflow-node-start')).toHaveAttribute('data-position', '300,260');
  });

  it('requires confirmation before deleting a non-entry node and hides delete for entry', async () => {
    const onChange = vi.fn();
    render(<WorkflowCanvas workflow={workflow} catalog={catalog} onChange={onChange} />);

    expect(screen.queryByTestId('delete-node-start')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('delete-node-classify'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Xoá node?');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('gỡ 2 cạnh liên quan');

    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('delete-node-classify'));
    fireEvent.click(screen.getByRole('button', { name: 'Xoá node' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));

    const next = onChange.mock.calls[0]?.[0] as ChatflowWorkflow;
    expect(next.nodes.map((node) => node.id)).toEqual(['start', 'answer']);
    expect(next.edges).toEqual([]);
  });

  it('adds nodes with catalog defaults via palette click and canvas drop while excluding start', () => {
    const onChange = vi.fn();
    render(<WorkflowCanvas workflow={workflow} catalog={catalog} onChange={onChange} />);

    expect(screen.queryByRole('button', { name: 'Thêm node Bắt đầu' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Thêm node Trả lời' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const addedByClick = (onChange.mock.calls[0]?.[0] as ChatflowWorkflow).nodes.at(-1);
    expect(addedByClick).toMatchObject({
      id: expect.stringMatching(/^answer_/),
      type: 'answer',
      title: 'Trả lời',
      config: { text: '', blocks: [] },
    });
    expect(addedByClick?.ui).toBeUndefined();

    const canvas = screen.getByTestId('workflow-canvas');
    fireEvent.dragOver(canvas);
    fireEvent.drop(canvas, {
      clientX: 360,
      clientY: 220,
      dataTransfer: {
        getData: (mime: string) => (mime === WORKFLOW_PALETTE_MIME ? 'if_else' : ''),
      },
    });

    expect(onChange).toHaveBeenCalledTimes(2);
    const addedByDrop = (onChange.mock.calls[1]?.[0] as ChatflowWorkflow).nodes.at(-1);
    expect(addedByDrop).toMatchObject({
      id: expect.stringMatching(/^if_else_/),
      type: 'if_else',
      title: 'Rẽ nhánh',
      ui: { position: { x: expect.any(Number), y: expect.any(Number) } },
    });
    expect(Number.isFinite(addedByDrop?.ui?.position?.x)).toBe(true);
    expect(Number.isFinite(addedByDrop?.ui?.position?.y)).toBe(true);

    const direct = createNodeFromCatalog(workflow, 'answer', catalog, { x: 50, y: 60 });
    expect(direct.nodes.at(-1)).toMatchObject({
      type: 'answer',
      config: { text: '', blocks: [] },
      ui: { position: { x: 50, y: 60 } },
    });
  });

  it('keeps palette and delete controls hidden when readOnly is explicitly true', () => {
    const onChange = vi.fn();
    render(<WorkflowCanvas workflow={workflow} catalog={catalog} readOnly onChange={onChange} />);

    expect(screen.queryByTestId('workflow-node-palette')).not.toBeInTheDocument();
    expect(screen.queryByTestId('delete-node-classify')).not.toBeInTheDocument();

    fireEvent.drop(screen.getByTestId('workflow-canvas'), {
      clientX: 100,
      clientY: 100,
      dataTransfer: {
        getData: (mime: string) => (mime === WORKFLOW_PALETTE_MIME ? 'answer' : ''),
      },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables NodePalette buttons when max node limit is reached', () => {
    const onAddNode = vi.fn();
    render(<NodePalette catalog={catalog} onAddNode={onAddNode} nodeCount={MAX_WORKFLOW_NODES} />);

    expect(screen.getByRole('button', { name: 'Thêm node Trả lời' })).toBeDisabled();
    expect(screen.getByText(`Đã đạt giới hạn ${MAX_WORKFLOW_NODES} node`)).toBeInTheDocument();
  });
});
