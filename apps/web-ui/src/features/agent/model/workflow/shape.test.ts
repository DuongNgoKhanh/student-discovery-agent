import { describe, expect, it } from 'vitest';
import { isRenderableWorkflow } from './shape';

describe('isRenderableWorkflow', () => {
  it('accepts a workflow with nodes and optional edges', () => {
    expect(isRenderableWorkflow({ entry: 'start', nodes: [{ id: 'start', type: 'start' }] })).toBe(true);
    expect(isRenderableWorkflow({ entry: 'start', nodes: [], edges: [{ id: 'e', source: 'a', target: 'b' }] })).toBe(true);
  });

  it.each([
    ['null', null],
    ['an empty object', {}],
    ['a misspelled nodes key', { entry: 'start', node: [] }],
    ['nodes that is not an array', { nodes: 'x' }],
    ['a null node', { nodes: [null] }],
    ['a node without an id', { nodes: [{ type: 'start' }] }],
    ['edges that is not an array', { nodes: [], edges: {} }],
    ['an edge without a target', { nodes: [], edges: [{ id: 'e', source: 'a' }] }],
  ])('rejects %s', (_label, value) => {
    expect(isRenderableWorkflow(value)).toBe(false);
  });
});
