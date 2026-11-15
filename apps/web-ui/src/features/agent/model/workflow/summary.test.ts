import { describe, expect, it } from 'vitest';
import type { ChatflowWorkflow, NodeTypeCatalog } from '../../types';
import { handleLabel, nodeHandles } from './handles';
import { nodeSummary } from './summary';
import { readableVariables } from './variables';

describe('nodeSummary', () => {
  it('says what each kind of node is set to do', () => {
    expect(nodeSummary({ id: 'b', type: 'if_else', config: { condition: { '==': [{ var: 'conv.step' }, 'x'] } } })).toEqual([
      'conv.step == "x"',
    ]);
    expect(nodeSummary({ id: 'k', type: 'knowledge_retrieval', config: { knowledge_base_id: 'tuyen_sinh', query: '{{sys.query}}' } }))
      .toEqual(['KB tuyen_sinh', '{{sys.query}}']);
    expect(nodeSummary({ id: 't', type: 'tool' })).toEqual(['Chưa chọn tool']);
    expect(
      nodeSummary({
        id: 'a',
        type: 'assign',
        config: { assignments: [{ variable: 'conv.step', value: 'done' }, { variable: 'conv.n', operation: 'add', value: 1 }, { variable: 'conv.x', operation: 'clear' }] },
      }),
    ).toEqual(['conv.step = "done"', 'conv.n += 1', 'xoá conv.x']);
    expect(nodeSummary({ id: 's', type: 'start' })).toEqual([]);
  });

  it('keeps each line short', () => {
    const [line] = nodeSummary({ id: 'l', type: 'llm', config: { prompt: 'x'.repeat(200) } });
    expect(line).toHaveLength(72);
    expect(line?.endsWith('…')).toBe(true);
  });
});

describe('nodeHandles', () => {
  it('lists static handles then config ones once, translating only static names', () => {
    const handles = nodeHandles(
      { id: 'c', type: 'intent_classifier', config: { labels: [{ id: 'tu_van' }, { id: 'other' }, { id: 'tu_van' }] } },
      { static: ['other', 'error'], from_config: { array: 'labels', id_field: 'id' } },
    );
    expect(handles.map((handle) => handle.id)).toEqual(['other', 'error', 'tu_van']);
    expect(handles.map(handleLabel)).toEqual(['Khác', 'Lỗi', 'tu_van']);
  });
});

describe('readableVariables', () => {
  it('offers static, conversation and upstream node variables only', () => {
    const catalog = {
      catalog_version: 't',
      namespaces: [
        { name: 'sys', title: 'Hệ thống', access: 'read_only', source: 'static', variables: [{ name: 'query', type: 'string' }] },
        { name: 'conv', title: 'Biến hội thoại', access: 'assign_only', source: 'workflow_variables' },
        { name: 'profile', title: 'Hồ sơ', access: 'read_only', source: 'profile_catalog' },
        { name: 'node', title: 'Output', access: 'read_only', source: 'node_output' },
      ],
      node_types: [
        { type: 'llm', title: 'LLM', description: '', config_schema: {}, handles: { static: ['success'] }, output_schema: { properties: { text: {} } } },
      ],
    } as unknown as NodeTypeCatalog;
    const workflow: ChatflowWorkflow = {
      entry: 'start',
      variables: [{ name: 'step', type: 'string', default: '' }],
      nodes: [{ id: 'start', type: 'start' }, { id: 'up', type: 'llm' }, { id: 'me', type: 'answer' }, { id: 'side', type: 'llm' }],
      edges: [
        { id: 'e1', source: 'start', source_handle: 'next', target: 'up' },
        { id: 'e2', source: 'up', source_handle: 'success', target: 'me' },
      ],
    };
    expect(readableVariables(workflow, catalog, 'me')).toEqual([
      { title: 'Hệ thống', paths: ['sys.query'] },
      { title: 'Biến hội thoại', paths: ['conv.step'] },
      { title: 'Output', paths: ['up.text'] },
    ]);
  });
});
