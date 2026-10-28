import { describe, expect, it } from 'vitest';
import { fieldId, getIn, parsePath, setIn } from './config';
import { changedSections, sectionOf } from './sections';

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
