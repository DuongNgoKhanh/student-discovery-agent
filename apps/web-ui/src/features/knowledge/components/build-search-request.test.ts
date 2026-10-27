import { describe, expect, it } from 'vitest';
import type { MetadataField } from '../types';
import { DEFAULT_SETTINGS, OPERATORS, buildSearchRequest, type FilterCondition } from './build-search-request';

const field = (name: string, type: MetadataField['type'], filterable = true): MetadataField =>
  ({ id: `f-${name}`, name, type, label: name.toUpperCase(), filterable, ordinal: 0 });
const fields = [field('school', 'string'), field('fee', 'number'), field('deadline', 'time'), field('tags', 'string_list'), field('note', 'string', false)];
const row = (name: string, operator: string, value = ''): FilterCondition => ({ id: name + operator + value, name, operator, value });

describe('buildSearchRequest', () => {
  it('omits unset optionals and trims the query', () => {
    expect(buildSearchRequest({ query: '  học phí  ', settings: DEFAULT_SETTINGS }, fields)).toEqual({ query: 'học phí', top_k: 4 });
  });

  it('sends set params clamped to the contract ranges', () => {
    const settings = { ...DEFAULT_SETTINGS, topK: 50, scoreThreshold: 0.35, semanticWeight: 0, maxChunksPerDoc: 2 };
    expect(buildSearchRequest({ query: 'q', settings }, fields))
      .toEqual({ query: 'q', top_k: 20, score_threshold: 0.35, semantic_weight: 0, max_chunks_per_doc: 2 });
    expect(buildSearchRequest({ query: 'q', settings: { ...DEFAULT_SETTINGS, topK: Number.NaN } }, fields).top_k).toBe(4);
  });

  it('converts number values, keeps valueless operators and drops incomplete rows', () => {
    const settings = {
      ...DEFAULT_SETTINGS, logicalOperator: 'or' as const,
      conditions: [
        row('fee', '≥', ' 42.5 '), row('school', 'is', 'HUTECH'), row('tags', 'empty', 'ignored'), row('deadline', 'before', '2026-12-01T00:00'),
        row('school', 'contains', '  '), row('fee', '>', 'abc'), row('note', 'is', 'x'), row('missing', 'is', 'x'), row('tags', 'is', 'x'),
      ],
    };
    expect(buildSearchRequest({ query: 'q', settings }, fields).metadata_condition).toEqual({
      logical_operator: 'or',
      conditions: [
        { name: 'fee', comparison_operator: '≥', value: 42.5 },
        { name: 'school', comparison_operator: 'is', value: 'HUTECH' },
        { name: 'tags', comparison_operator: 'empty' },
        { name: 'deadline', comparison_operator: 'before', value: '2026-12-01T00:00' },
      ],
    });
    expect(buildSearchRequest({ query: 'q', settings: { ...DEFAULT_SETTINGS, conditions: [row('fee', '=')] } }, fields))
      .not.toHaveProperty('metadata_condition');
  });
});

describe('OPERATORS', () => {
  it('matches the runtime operator set per field type', () => {
    expect(OPERATORS).toEqual({
      string: ['is', 'is not', 'contains', 'not contains', 'start with', 'end with', 'empty', 'not empty'],
      number: ['=', '≠', '>', '<', '≥', '≤', 'empty', 'not empty'],
      time: ['is', 'before', 'after', 'empty', 'not empty'],
      string_list: ['contains', 'not contains', 'empty', 'not empty'],
    });
  });
});
