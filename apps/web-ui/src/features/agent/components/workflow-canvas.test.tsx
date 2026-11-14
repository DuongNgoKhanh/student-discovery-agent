import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentIssue, ChatflowWorkflow, NodeTypeCatalog } from '../types';
import { WorkflowCanvas, workflowCanvasTargets } from './workflow-canvas';

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
    { type: 'intent_classifier', title: 'Phân loại', description: 'Classifies', config_schema: {}, handles: { static: [], from_config: { array: 'labels', id_field: 'id' } }, output_schema: {} },
    { type: 'answer', title: 'Trả lời', description: 'Answer', config_schema: {}, handles: { static: [] }, output_schema: {} },
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
  });
});
