import { describe, expect, it } from 'vitest';
import fixture from '../../../generated/agent-tool-catalog.json';
import { bindKnowledge, TOOL_CATALOG } from './tools';

describe('TOOL_CATALOG', () => {
  it('is the runtime catalog fixture, in order', () => {
    expect(TOOL_CATALOG.map(t => [t.name, t.version, t.label])).toEqual(
      fixture.tools.map(t => [t.name, t.version, t.label]),
    );
  });

  it('maps each tool to the params editor the runtime names', () => {
    expect(Object.fromEntries(TOOL_CATALOG.map(t => [t.name, t.params]))).toMatchObject({
      'assessment.start': 'json',
      'result.explain': 'none',
      'knowledge.search': 'knowledge.search',
      'knowledge.show': 'knowledge.show',
    });
  });
});

describe('bindKnowledge', () => {
  it('leaves the tools untouched when the suggestion has no knowledge base id', () => {
    const tools = [
      { name: 'knowledge.search', version: 1, params: { knowledge_base_id: 'kb_old', top_k: 3 } },
    ];
    expect(bindKnowledge(tools, { 'knowledge.search': { auto_filter_fields: [] } })).toBe(tools);
  });

  it('drops a knowledge.show suggestion whose display is not a list of fields', () => {
    const bound = bindKnowledge([], {
      'knowledge.search': { knowledge_base_id: 'kb_x' },
      'knowledge.show': { display: 'school' },
    });
    expect(bound.map((t) => t.name)).toEqual(['knowledge.search']);
  });
});
