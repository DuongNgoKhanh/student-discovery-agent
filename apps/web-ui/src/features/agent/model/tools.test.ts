import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bindKnowledge, TOOL_CATALOG } from './tools';

// Mirrors agent-runtime TOOL_DECLARATIONS; test_tool_catalog_fixture.py checks the runtime side of the same file.
const fixture = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../../../contracts/fixtures/agent-tool-catalog.json'),
    'utf8',
  ),
) as {
  tools: Array<{ name: string; version: number; has_params: boolean }>;
};

describe('TOOL_CATALOG', () => {
  it('lists exactly the tools the runtime declares', () => {
    expect(
      TOOL_CATALOG.map((t) => ({
        name: t.name,
        version: t.version,
        has_params: t.params !== 'none',
      })),
    ).toEqual(fixture.tools);
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
