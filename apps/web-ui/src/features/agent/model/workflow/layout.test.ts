import { describe, expect, it } from 'vitest';
import type { ChatflowWorkflow } from '../../types';
import { computeWorkflowLayout, type WorkflowPosition } from './layout';

function mustPos(positions: Record<string, WorkflowPosition>, id: string): WorkflowPosition {
  const pos = positions[id];
  if (!pos) throw new Error(`Missing position for node "${id}"`);
  return pos;
}

describe('computeWorkflowLayout', () => {
  it('returns an empty map for an empty workflow', () => {
    expect(computeWorkflowLayout({ entry: 'start', nodes: [], edges: [] })).toEqual({});
  });

  it('rejects options that would stall the overlap search or produce NaN positions', () => {
    const workflow: ChatflowWorkflow = {
      entry: 'start',
      nodes: [
        { id: 'start', type: 'start', ui: { position: { x: 40, y: 40 } } },
        { id: 'a', type: 'answer' },
      ],
    };
    for (const options of [
      { nodeGap: -120 },
      { nodeHeight: 0 },
      { nodeWidth: Number.NaN },
      { origin: { x: Number.POSITIVE_INFINITY, y: 0 } },
    ]) {
      expect(() => computeWorkflowLayout(workflow, options)).toThrowError(RangeError);
    }
  });

  it('layers reachable nodes by longest path from entry (AT #5)', () => {
    const workflow: ChatflowWorkflow = {
      entry: 'start',
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'short_branch', type: 'llm' },
        { id: 'long_1', type: 'llm' },
        { id: 'long_2', type: 'if_else' },
        { id: 'join', type: 'answer' },
      ],
      edges: [
        { id: 'e1', source: 'start', source_handle: 'next', target: 'short_branch' },
        { id: 'e2', source: 'short_branch', source_handle: 'next', target: 'join' },
        { id: 'e3', source: 'start', source_handle: 'next', target: 'long_1' },
        { id: 'e4', source: 'long_1', source_handle: 'next', target: 'long_2' },
        { id: 'e5', source: 'long_2', source_handle: 'true', target: 'join' },
      ],
    };

    const pos = computeWorkflowLayout(workflow);
    expect(mustPos(pos, 'start').x).toBeLessThan(mustPos(pos, 'short_branch').x);
    expect(mustPos(pos, 'short_branch').x).toBe(mustPos(pos, 'long_1').x);
    expect(mustPos(pos, 'long_1').x).toBeLessThan(mustPos(pos, 'long_2').x);
    // join has longest path 3 (start -> long_1 -> long_2 -> join)
    expect(mustPos(pos, 'long_2').x).toBeLessThan(mustPos(pos, 'join').x);
  });

  it('orders nodes within the same layer by handle order', () => {
    const workflow: ChatflowWorkflow = {
      entry: 'start',
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'branch', type: 'if_else' },
        { id: 'false_node', type: 'answer' },
        { id: 'true_node', type: 'answer' },
      ],
      edges: [
        { id: 'e0', source: 'start', source_handle: 'next', target: 'branch' },
        { id: 'e_false', source: 'branch', source_handle: 'false', target: 'false_node' },
        { id: 'e_true', source: 'branch', source_handle: 'true', target: 'true_node' },
      ],
    };

    const pos = computeWorkflowLayout(workflow, {
      handleOrderByNode: { branch: ['true', 'false'] },
    });

    expect(mustPos(pos, 'true_node').x).toBe(mustPos(pos, 'false_node').x);
    expect(mustPos(pos, 'true_node').y).toBeLessThan(mustPos(pos, 'false_node').y);
  });

  it('preserves existing ui.position and avoids overlapping fixed nodes (AT #5)', () => {
    const workflow: ChatflowWorkflow = {
      entry: 'start',
      nodes: [
        { id: 'start', type: 'start', ui: { position: { x: 40, y: 40 } } },
        // Fixed node sits right where layer 1, row 0 would normally be placed (380, 40)
        { id: 'fixed_mid', type: 'answer', ui: { position: { x: 380, y: 40 } } },
        { id: 'auto_mid', type: 'llm' },
      ],
      edges: [
        { id: 'e1', source: 'start', source_handle: 'next', target: 'auto_mid' },
        { id: 'e2', source: 'auto_mid', source_handle: 'next', target: 'fixed_mid' },
      ],
    };

    const nodeWidth = 240;
    const nodeHeight = 120;
    const pos = computeWorkflowLayout(workflow, { nodeWidth, nodeHeight });

    expect(pos.start).toEqual({ x: 40, y: 40 });
    expect(pos.fixed_mid).toEqual({ x: 380, y: 40 });
    expect(mustPos(pos, 'auto_mid').x).toBe(380);
    // Shifted vertically so it does not overlap fixed_mid
    expect(
      Math.abs(mustPos(pos, 'auto_mid').y - mustPos(pos, 'fixed_mid').y),
    ).toBeGreaterThanOrEqual(nodeHeight);
  });

  it('places unreachable nodes in an extra layer after the deepest reachable layer without overlap', () => {
    const workflow: ChatflowWorkflow = {
      entry: 'start',
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'end', type: 'answer' },
        { id: 'orphan_1', type: 'answer' },
        { id: 'orphan_2', type: 'llm' },
      ],
      edges: [{ id: 'e1', source: 'start', source_handle: 'next', target: 'end' }],
    };

    const nodeWidth = 240;
    const nodeHeight = 120;
    const pos = computeWorkflowLayout(workflow, { nodeWidth, nodeHeight });

    expect(mustPos(pos, 'orphan_1').x).toBeGreaterThan(mustPos(pos, 'end').x);
    expect(mustPos(pos, 'orphan_2').x).toBe(mustPos(pos, 'orphan_1').x);
    expect(mustPos(pos, 'orphan_1').y).toBeLessThan(mustPos(pos, 'orphan_2').y);

    const boxes = Object.values(pos);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlaps =
          Math.abs(a.x - b.x) < nodeWidth && Math.abs(a.y - b.y) < nodeHeight;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('handles missing entry and pre-existing cycles safely', () => {
    const missingEntry: ChatflowWorkflow = {
      entry: 'nonexistent',
      nodes: [
        { id: 'a', type: 'answer' },
        { id: 'b', type: 'answer' },
      ],
      edges: [],
    };
    const posMissing = computeWorkflowLayout(missingEntry);
    expect(mustPos(posMissing, 'a').x).toBe(mustPos(posMissing, 'b').x);
    expect(mustPos(posMissing, 'a').y).toBeLessThan(mustPos(posMissing, 'b').y);

    const cyclic: ChatflowWorkflow = {
      entry: 'a',
      nodes: [
        { id: 'a', type: 'start' },
        { id: 'b', type: 'llm' },
        { id: 'c', type: 'answer' },
      ],
      edges: [
        { id: 'e1', source: 'a', source_handle: 'next', target: 'b' },
        { id: 'e2', source: 'b', source_handle: 'next', target: 'c' },
        { id: 'e3', source: 'c', source_handle: 'next', target: 'b' },
      ],
    };
    const posCyclic = computeWorkflowLayout(cyclic);
    expect(mustPos(posCyclic, 'a').x).toBeLessThan(mustPos(posCyclic, 'b').x);
    expect(mustPos(posCyclic, 'b').x).toBeLessThan(mustPos(posCyclic, 'c').x);
  });
});
