import { describe, expect, it } from 'vitest';
import type { ChatflowEdge, ChatflowNode } from '../../types';
import { ancestorsOf, validTargets, wouldCreateCycle } from './graph';

const makeEdge = (source: string, target: string, id = `${source}_${target}`): ChatflowEdge => ({
  id,
  source,
  source_handle: 'next',
  target,
});

const nodes: ChatflowNode[] = [
  { id: 'start', type: 'start', title: 'Start' },
  { id: 'classify', type: 'intent_classifier', title: 'Classify' },
  { id: 'branch', type: 'if_else', title: 'Branch' },
  { id: 'answer', type: 'answer', title: 'Answer' },
  { id: 'orphan', type: 'answer', title: 'Orphan' },
];

const chainEdges: ChatflowEdge[] = [
  makeEdge('start', 'classify'),
  makeEdge('classify', 'branch'),
  makeEdge('branch', 'answer'),
];

describe('ancestorsOf', () => {
  it('returns an empty set for a root node or when edges are empty', () => {
    expect(ancestorsOf([], 'start')).toEqual(new Set());
    expect(ancestorsOf(chainEdges, 'start')).toEqual(new Set());
  });

  it('collects direct and transitive ancestors in a chain', () => {
    expect(ancestorsOf(chainEdges, 'branch')).toEqual(new Set(['start', 'classify']));
    expect(ancestorsOf(chainEdges, 'answer')).toEqual(new Set(['start', 'classify', 'branch']));
  });

  it('collects ancestors across diamond DAG paths without duplicates', () => {
    const diamond = [
      makeEdge('start', 'left'),
      makeEdge('start', 'right'),
      makeEdge('left', 'join'),
      makeEdge('right', 'join'),
    ];
    expect(ancestorsOf(diamond, 'join')).toEqual(new Set(['start', 'left', 'right']));
  });

  it('terminates safely if the input graph already contains a cycle', () => {
    const cyclic = [makeEdge('a', 'b'), makeEdge('b', 'c'), makeEdge('c', 'a')];
    expect(ancestorsOf(cyclic, 'c')).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('wouldCreateCycle', () => {
  it('rejects self-loops', () => {
    expect(wouldCreateCycle([], 'start', 'start')).toBe(true);
    expect(wouldCreateCycle(chainEdges, 'branch', 'branch')).toBe(true);
  });

  it('rejects edges pointing to direct or transitive ancestors', () => {
    expect(wouldCreateCycle(chainEdges, 'classify', 'start')).toBe(true);
    expect(wouldCreateCycle(chainEdges, 'answer', 'start')).toBe(true);
    expect(wouldCreateCycle(chainEdges, 'answer', 'classify')).toBe(true);
  });

  it('allows forward, diamond, and disconnected-node edges', () => {
    expect(wouldCreateCycle(chainEdges, 'start', 'answer')).toBe(false);
    expect(wouldCreateCycle(chainEdges, 'branch', 'orphan')).toBe(false);
    expect(wouldCreateCycle(chainEdges, 'orphan', 'start')).toBe(false);
  });

  it('returns false when source or target is empty', () => {
    expect(wouldCreateCycle(chainEdges, '', 'start')).toBe(false);
    expect(wouldCreateCycle(chainEdges, 'start', '')).toBe(false);
  });
});

describe('validTargets', () => {
  it('excludes self and all ancestors while preserving node order (AT #2)', () => {
    expect(validTargets(nodes, chainEdges, 'branch').map((n) => n.id)).toEqual([
      'answer',
      'orphan',
    ]);
    expect(validTargets(nodes, chainEdges, 'answer').map((n) => n.id)).toEqual(['orphan']);
  });

  it('excludes only self for a root or disconnected node', () => {
    expect(validTargets(nodes, chainEdges, 'start').map((n) => n.id)).toEqual([
      'classify',
      'branch',
      'answer',
      'orphan',
    ]);
    expect(validTargets(nodes, chainEdges, 'orphan').map((n) => n.id)).toEqual([
      'classify',
      'branch',
      'answer',
    ]);
  });

  it('never offers a start node as a target', () => {
    expect(validTargets(nodes, [], 'orphan').map((n) => n.id)).not.toContain('start');
  });
});
