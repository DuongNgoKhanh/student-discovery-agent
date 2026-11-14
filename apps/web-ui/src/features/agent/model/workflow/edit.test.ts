import { describe, expect, it } from 'vitest';
import type { ChatflowNode, ChatflowWorkflow } from '../../types';
import {
  addEdge,
  addNode,
  deleteNode,
  generateEdgeId,
  generateNodeId,
  MAX_WORKFLOW_EDGES,
  MAX_WORKFLOW_NODES,
  moveNode,
  removeEdge,
  setHandleEdge,
  updateNode,
  WorkflowEditError,
} from './edit';

function makeBaseWorkflow(): ChatflowWorkflow {
  return {
    entry: 'start',
    nodes: [
      { id: 'start', type: 'start', title: 'Start' },
      { id: 'branch', type: 'if_else', title: 'Branch', config: { condition: { '==': [1, 1] } } },
      { id: 'answer_yes', type: 'answer', title: 'Yes' },
      { id: 'answer_no', type: 'answer', title: 'No' },
    ],
    edges: [
      { id: 'e_start', source: 'start', source_handle: 'next', target: 'branch' },
      { id: 'e_true', source: 'branch', source_handle: 'true', target: 'answer_yes' },
    ],
  };
}

describe('generateNodeId & generateEdgeId', () => {
  it('generates valid unique node IDs avoiding collisions and reserved IDs', () => {
    const wf: ChatflowWorkflow = {
      entry: 'start',
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'llm_1', type: 'llm' },
      ],
    };
    expect(generateNodeId(wf, 'llm')).toBe('llm_2');
    expect(generateNodeId(wf, '123-Bad Prefix!')).toBe('node_1');

    const longId = generateNodeId(wf, 'a'.repeat(50));
    expect(longId.length).toBeLessThanOrEqual(40);
    expect(longId).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
  });

  it('generates valid unique edge IDs within 40 characters', () => {
    const wf: ChatflowWorkflow = {
      entry: 'start',
      nodes: [{ id: 'start', type: 'start' }],
      edges: [{ id: 'e_start_next_1', source: 'start', source_handle: 'next', target: 'start' }],
    };
    expect(generateEdgeId(wf, 'e_start_next')).toBe('e_start_next_2');
    const longEdgeId = generateEdgeId(wf, 'e_' + 'x'.repeat(50));
    expect(longEdgeId.length).toBeLessThanOrEqual(40);
    expect(longEdgeId).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
  });
});

describe('addNode', () => {
  it('adds a valid node immutably and preserves unknown fields', () => {
    const wf = {
      ...makeBaseWorkflow(),
      custom_meta: { owner: 'studio' },
    } as ChatflowWorkflow & { custom_meta: { owner: string } };
    const snapshot = structuredClone(wf);

    const next = addNode(wf, {
      id: 'kb_search',
      type: 'knowledge_retrieval',
      title: 'KB',
      extra_field: 42,
    } as ChatflowNode & { extra_field: number });

    expect(wf).toEqual(snapshot);
    expect(next).not.toBe(wf);
    expect(next.nodes).toHaveLength(5);
    expect((next as typeof wf).custom_meta).toEqual({ owner: 'studio' });
    expect((next.nodes[4] as ChatflowNode & { extra_field: number }).extra_field).toBe(42);
  });

  it('rejects invalid, reserved, and duplicate node IDs', () => {
    const wf = makeBaseWorkflow();

    for (const badId of ['', 'Upper', '1node', 'has-dash', 'a'.repeat(41)]) {
      expect(() => addNode(wf, { id: badId, type: 'llm' })).toThrowError(WorkflowEditError);
    }
    for (const reserved of ['sys', 'conv', 'profile', 'result']) {
      expect(() => addNode(wf, { id: reserved, type: 'llm' })).toThrowError(/reserved/i);
    }
    expect(() => addNode(wf, { id: 'start', type: 'llm' })).toThrowError(/Duplicate/i);
  });

  it('enforces maximum of 50 nodes', () => {
    const nodes: ChatflowNode[] = Array.from({ length: MAX_WORKFLOW_NODES }, (_, i) => ({
      id: `n_${i}`,
      type: 'llm',
    }));
    const wf: ChatflowWorkflow = { entry: 'n_0', nodes };

    expect(() => addNode(wf, { id: 'n_50', type: 'llm' })).toThrowError(/50/);
  });
});

describe('deleteNode', () => {
  it('removes the node and all incoming and outgoing edges', () => {
    const wf = makeBaseWorkflow();
    const next = deleteNode(wf, 'branch');

    expect(next.nodes.map((n) => n.id)).toEqual(['start', 'answer_yes', 'answer_no']);
    expect(next.edges).toEqual([]);
    expect(wf.nodes).toHaveLength(4);
    expect(wf.edges).toHaveLength(2);
  });

  it('refuses to delete the entry node', () => {
    const wf = makeBaseWorkflow();
    expect(() => deleteNode(wf, 'start')).toThrowError(
      expect.objectContaining({ code: 'ENTRY_NODE' }),
    );
  });

  it('returns the original workflow reference when node does not exist', () => {
    const wf = makeBaseWorkflow();
    expect(deleteNode(wf, 'missing')).toBe(wf);
  });

  it('keeps edges undefined if workflow had no edges array', () => {
    const wf: ChatflowWorkflow = {
      entry: 'start',
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'end', type: 'answer' },
      ],
    };
    const next = deleteNode(wf, 'end');
    expect(next.edges).toBeUndefined();
    expect(next.nodes.map((n) => n.id)).toEqual(['start']);
  });
});

describe('moveNode', () => {
  it('updates only ui.position and preserves node config, ui extras, and workflow fields', () => {
    const wf: ChatflowWorkflow = {
      ...makeBaseWorkflow(),
      nodes: [
        {
          id: 'start',
          type: 'start',
          title: 'Start',
          config: { greeting: 'hi' },
          ui: { position: { x: 10, y: 20 }, collapsed: true } as ChatflowNode['ui'] & {
            collapsed: boolean;
          },
        },
      ],
    };

    const next = moveNode(wf, 'start', { x: 300, y: 150 });
    expect(next.nodes[0]?.ui?.position).toEqual({ x: 300, y: 150 });
    expect((next.nodes[0]?.ui as { collapsed?: boolean } | undefined)?.collapsed).toBe(true);
    expect(next.nodes[0]?.config).toEqual({ greeting: 'hi' });
    expect(next.nodes[0]?.title).toBe('Start');
    expect(wf.nodes[0]?.ui?.position).toEqual({ x: 10, y: 20 });
  });

  it('rejects non-finite coordinates and no-ops for missing nodes', () => {
    const wf = makeBaseWorkflow();
    expect(() => moveNode(wf, 'start', { x: Number.NaN, y: 0 })).toThrowError(WorkflowEditError);
    expect(moveNode(wf, 'missing', { x: 10, y: 20 })).toBe(wf);
  });
});

describe('updateNode', () => {
  it('updates node properties immutably without altering id', () => {
    const wf = makeBaseWorkflow();
    const next = updateNode(wf, 'branch', { title: 'Updated Branch' });
    expect(next.nodes.find((n) => n.id === 'branch')?.title).toBe('Updated Branch');
    expect(wf.nodes.find((n) => n.id === 'branch')?.title).toBe('Branch');
  });
});

describe('addEdge, removeEdge, setHandleEdge', () => {
  it('allows multiple distinct handles on the same source node (AT #1)', () => {
    const wf = makeBaseWorkflow();
    const next = addEdge(wf, {
      source: 'branch',
      source_handle: 'false',
      target: 'answer_no',
    });
    expect(next.edges).toHaveLength(3);
    expect(next.edges?.[2]).toMatchObject({
      source: 'branch',
      source_handle: 'false',
      target: 'answer_no',
    });
  });

  it('rejects a second outgoing edge on the same handle', () => {
    const wf = makeBaseWorkflow();
    expect(() =>
      addEdge(wf, {
        source: 'branch',
        source_handle: 'true',
        target: 'answer_no',
      }),
    ).toThrowError(/already has an outgoing edge/i);
  });

  it('rejects self-loops, cycles, missing nodes, and duplicate edge IDs', () => {
    const wf = makeBaseWorkflow();
    expect(() =>
      addEdge(wf, { source: 'answer_yes', source_handle: 'next', target: 'answer_yes' }),
    ).toThrowError(/cycle/i);
    expect(() =>
      addEdge(wf, { source: 'answer_yes', source_handle: 'next', target: 'branch' }),
    ).toThrowError(/cycle/i);
    expect(() =>
      addEdge(wf, { source: 'missing', source_handle: 'next', target: 'answer_no' }),
    ).toThrowError(/does not exist/i);
    expect(() =>
      addEdge(wf, {
        id: 'e_true',
        source: 'branch',
        source_handle: 'false',
        target: 'answer_no',
      }),
    ).toThrowError(/Duplicate edge id/i);
  });

  it('rejects edges into a start node, even from an unconnected node', () => {
    const wf = makeBaseWorkflow();
    expect(() =>
      addEdge(wf, { source: 'answer_no', source_handle: 'next', target: 'start' }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_TARGET' }));
  });

  it('enforces maximum of 100 edges', () => {
    const nodes: ChatflowNode[] = [
      { id: 'n_0', type: 'if_else' },
      { id: 'n_1', type: 'answer' },
    ];
    const edges = Array.from({ length: MAX_WORKFLOW_EDGES }, (_, i) => ({
      id: `e_${i}`,
      source: 'n_0',
      source_handle: `h_${i}`,
      target: 'n_1',
    }));
    const wf: ChatflowWorkflow = { entry: 'n_0', nodes, edges };

    expect(() =>
      addEdge(wf, { source: 'n_0', source_handle: 'h_100', target: 'n_1' }),
    ).toThrowError(/100/);
  });

  it('removes an edge by id and supports setHandleEdge replace/clear', () => {
    const wf = makeBaseWorkflow();
    const removed = removeEdge(wf, 'e_true');
    expect(removed.edges?.map((e) => e.id)).toEqual(['e_start']);
    expect(removeEdge(wf, 'nonexistent')).toBe(wf);

    const replaced = setHandleEdge(wf, 'branch', 'true', 'answer_no');
    expect(replaced.edges?.find((e) => e.source === 'branch' && e.source_handle === 'true')).toEqual({
      id: 'e_true',
      source: 'branch',
      source_handle: 'true',
      target: 'answer_no',
    });

    const cleared = setHandleEdge(replaced, 'branch', 'true', null);
    expect(cleared.edges?.map((e) => e.id)).toEqual(['e_start']);
  });

  it('stores only contract fields when given a React Flow style connection', () => {
    const wf = makeBaseWorkflow();
    const snapshot = structuredClone(wf);
    const next = addEdge(wf, {
      source: 'branch',
      source_handle: 'false',
      target: 'answer_no',
      sourceHandle: 'false',
      selected: true,
    } as Parameters<typeof addEdge>[1]);

    expect(wf).toEqual(snapshot);
    expect(next.edges?.[2]).toEqual({
      id: 'e_branch_false_1',
      source: 'branch',
      source_handle: 'false',
      target: 'answer_no',
    });
  });

  it('retargets a handle in place, keeping edge order', () => {
    const wf = makeBaseWorkflow();
    const next = setHandleEdge(wf, 'start', 'next', 'answer_no');
    expect(next.edges?.map((e) => [e.id, e.target])).toEqual([
      ['e_start', 'answer_no'],
      ['e_true', 'answer_yes'],
    ]);
    expect(setHandleEdge(wf, 'start', 'next', 'branch')).toBe(wf);
  });

  it('leaves the workflow unchanged when retargeting would create a cycle', () => {
    const wf = makeBaseWorkflow();
    const snapshot = structuredClone(wf);
    expect(() => setHandleEdge(wf, 'answer_yes', 'next', 'branch')).toThrowError(
      expect.objectContaining({ code: 'CYCLE_DETECTED' }),
    );
    expect(wf).toEqual(snapshot);
  });

  it('validates source and handle even when clearing', () => {
    const wf = makeBaseWorkflow();
    expect(() => setHandleEdge(wf, 'missing', 'next', null)).toThrowError(
      expect.objectContaining({ code: 'NODE_NOT_FOUND' }),
    );
    expect(() => setHandleEdge(wf, 'branch', 'Bad', null)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ID' }),
    );
  });
});
