import { describe, expect, it } from 'vitest';
import { parseWorkflowIssuePath } from './issue-path';
import type { ChatflowWorkflow } from '../../types';

const workflow: ChatflowWorkflow = {
  entry: 'start',
  variables: [{ name: 'grade', type: 'string', default: '12' }],
  nodes: [
    { id: 'start', type: 'start', config: {} },
    { id: 'classify', type: 'if_else', config: { labels: ['yes', 'no'] } },
  ],
  edges: [{ id: 'edge_true', source: 'classify', source_handle: 'true', target: 'answer' }],
};

describe('parseWorkflowIssuePath', () => {
  it('resolves a node config path to the node id', () => {
    expect(parseWorkflowIssuePath('workflow.nodes[1].config.labels[0]', workflow)).toEqual({
      kind: 'node',
      nodeId: 'classify',
      nodeIndex: 1,
      configPath: ['labels', 0],
    });
  });

  it('resolves edges and variables', () => {
    expect(parseWorkflowIssuePath('workflow.edges[0].target', workflow)).toEqual({
      kind: 'edge',
      edgeId: 'edge_true',
      edgeIndex: 0,
      configPath: ['target'],
    });
    expect(parseWorkflowIssuePath('workflow.variables[0].default', workflow)).toEqual({
      kind: 'variable',
      variableIndex: 0,
      variableName: 'grade',
      configPath: ['default'],
    });
  });

  it('resolves workflow-level paths', () => {
    expect(parseWorkflowIssuePath('workflow.entry', workflow)).toEqual({
      kind: 'workflow',
      configPath: ['entry'],
    });
    expect(parseWorkflowIssuePath('workflow.budget.max_nodes', workflow)).toEqual({
      kind: 'workflow',
      configPath: ['budget', 'max_nodes'],
    });
    expect(parseWorkflowIssuePath('workflow.nodes', workflow)).toEqual({ kind: 'workflow' });
  });

  it('resolves bare node paths without config', () => {
    expect(parseWorkflowIssuePath('workflow.nodes[0]', workflow)).toEqual({
      kind: 'node',
      nodeId: 'start',
      nodeIndex: 0,
      configPath: [],
    });
  });

  it('falls back to workflow for malformed or out-of-range paths', () => {
    for (const path of [
      'agent.nodes[0]',
      'workflow.nodes[4].config.x',
      'workflow.edges[2]',
      'workflow.variables[2]',
      'workflow.nodes[x]',
    ]) {
      expect(parseWorkflowIssuePath(path, workflow)).toEqual({ kind: 'workflow' });
    }
    const partial = {
      entry: 'start',
      nodes: [{ type: 'start' }],
      edges: [{ source: 'start' }],
    } as unknown as ChatflowWorkflow;
    expect(parseWorkflowIssuePath('workflow.nodes[0].config', partial)).toEqual({
      kind: 'workflow',
    });
    expect(parseWorkflowIssuePath('workflow.edges[0].target', partial)).toEqual({
      kind: 'workflow',
    });
  });
});
