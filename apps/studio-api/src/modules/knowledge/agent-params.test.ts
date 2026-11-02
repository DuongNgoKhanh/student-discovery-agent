import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAgentParams } from '@/modules/knowledge/agent-params';

const fixture = JSON.parse(readFileSync(
  resolve(__dirname, '../../../../../contracts/fixtures/knowledge-agent-params.json'), 'utf8',
)) as Record<string, unknown>;

/** 12 fields: one 70-character label, one blank label, 11 filterable. */
const fields = Array.from({ length: 12 }, (_, index) => {
  const n = index + 1;
  return {
    name: `f${String(n).padStart(2, '0')}`, ordinal: n, filterable: n <= 11,
    label: n === 2 ? 'x'.repeat(70) : n === 3 ? '   ' : `Nhãn ${n}`,
  };
});

describe('buildAgentParams', () => {
  it('matches the shared fixture that the runtime validates (params only, without warnings)', () => {
    const { warnings, ...params } = buildAgentParams('kb-demo', [...fields].reverse());
    expect(params).toEqual(fixture);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('has no warnings when everything fits', () => {
    expect(buildAgentParams('kb', [{ name: 'major', label: ' Ngành ', filterable: true, ordinal: 1 }])).toEqual({
      'knowledge.search': { knowledge_base_id: 'kb', top_k: 4, auto_filter_fields: ['major'] },
      'knowledge.show': { display: [{ field: 'major', label: 'Ngành' }] },
      warnings: [],
    });
  });

  it('warns when there are no fields', () => {
    const params = buildAgentParams('kb', []);
    expect(params['knowledge.show'].display).toEqual([]);
    expect(params.warnings).toEqual(['KB chưa có field nào: knowledge.show cần ít nhất 1 field.']);
  });
});
