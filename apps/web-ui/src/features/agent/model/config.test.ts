import { describe, expect, it } from 'vitest';
import { canonical, fieldId, getIn, parsePath, setIn } from './config';
import { changedSections, sectionOf } from './sections';
import { bindKnowledge } from './tools';

describe('config paths', () => {
  it('parses runtime issue paths', () => {
    expect(parsePath('tools[3].params.top_k')).toEqual(['tools', 3, 'params', 'top_k']);
    expect(parsePath('')).toEqual([]);
  });
  it('reads and writes nested values without mutating', () => {
    const base = { persona: { name: 'A' }, tools: [{ name: 'x', params: {} }] };
    const next = setIn(base, ['tools', 0, 'params', 'top_k'], 4);
    expect(getIn(next, ['tools', 0, 'params', 'top_k'])).toBe(4);
    expect(base.tools[0]!.params).toEqual({});
    expect(setIn(base, ['persona', 'name'], 'B').persona).toEqual({ name: 'B' });
  });
  it('builds stable field ids', () => {
    expect(fieldId('tools[3].params.top_k')).toBe('field-tools.3.params.top_k');
    expect(fieldId(['persona', 'name'])).toBe('field-persona.name');
  });
});

describe('sections', () => {
  it('maps issue paths to sections', () => {
    expect(sectionOf('greeting_text')).toBe('persona');
    expect(sectionOf('model.temperature')).toBe('model');
    expect(sectionOf('tools[2].params.knowledge_base_id')).toBe('tools');
    expect(sectionOf('guardrails.refusal_text')).toBe('limits');
    expect(sectionOf('allowed_activity_profiles[0]')).toBe('json');
    expect(sectionOf('')).toBe('json');
  });
  it('lists changed sections by top-level key', () => {
    expect(changedSections({ persona: { name: 'A' }, model: { ref: 'x' } }, { persona: { name: 'B' }, model: { ref: 'x' } })).toEqual(['persona']);
  });
});

describe('canonical', () => {
  it('ignores object key order but not array order', () => {
    expect(canonical({ a: 1, b: { y: 1, x: [{ n: 1, m: 2 }] } })).toBe(canonical({ b: { x: [{ m: 2, n: 1 }], y: 1 }, a: 1 }));
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
  });
});

describe('bindKnowledge', () => {
  const suggested = (display: unknown[]) => ({
    'knowledge.search': { knowledge_base_id: 'kb_new', top_k: 4, auto_filter_fields: ['school'] },
    'knowledge.show': { display },
    warnings: [],
  });
  const tools = [
    { name: 'ui.suggest_replies', version: 1 },
    { name: 'knowledge.search', version: 1, params: { knowledge_base_id: 'kb_old', top_k: 8, score_threshold: 0.3, semantic_weight: 0.7,
      max_chunks_per_doc: 2, auto_filter_fields: ['old'] } },
    { name: 'knowledge.show', version: 1, params: { display: [{ field: 'old', label: 'Cũ' }] } },
  ];

  it('takes the KB id and filter fields from the suggestion and keeps the existing search tuning', () => {
    const next = bindKnowledge(tools, suggested([{ field: 'school', label: 'Trường' }]));
    expect(next.find(t => t.name === 'knowledge.search')!.params).toEqual({ knowledge_base_id: 'kb_new', top_k: 8, score_threshold: 0.3,
      semantic_weight: 0.7, max_chunks_per_doc: 2, auto_filter_fields: ['school'] });
    expect(next.find(t => t.name === 'knowledge.show')!.params).toEqual({ display: [{ field: 'school', label: 'Trường' }] });
    expect(next[0]!.name).toBe('ui.suggest_replies');
  });

  it('uses the suggested defaults when search was not bound yet', () => {
    const next = bindKnowledge([], suggested([{ field: 'school', label: 'Trường' }]));
    expect(next.find(t => t.name === 'knowledge.search')!.params).toEqual({ knowledge_base_id: 'kb_new', top_k: 4, auto_filter_fields: ['school'] });
  });

  it('omits knowledge.show when the KB suggests no display fields', () => {
    const next = bindKnowledge(tools, suggested([]));
    expect(next.map(t => t.name)).toEqual(['ui.suggest_replies', 'knowledge.search']);
  });
});
