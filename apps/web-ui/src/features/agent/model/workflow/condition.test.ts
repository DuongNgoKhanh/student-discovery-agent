import { describe, expect, it } from 'vitest';
import { conditionToRows, formatCondition, rowsToCondition } from './condition';

describe('conditionToRows', () => {
  it('reads an absent or empty condition as no rows', () => {
    expect(conditionToRows(undefined)).toEqual({ logic: 'and', rows: [] });
    expect(conditionToRows({})).toEqual({ logic: 'and', rows: [] });
  });

  it('reads one comparison and a flat and/or list', () => {
    expect(conditionToRows({ '==': [{ var: 'sys.turn_index' }, 0] })).toEqual({
      logic: 'and',
      rows: [{ variable: 'sys.turn_index', operator: '==', value: '0' }],
    });
    expect(conditionToRows({ or: [{ missing: ['conv.step'] }, { '!=': [{ var: ['conv.step'] }, 'done'] }] })).toEqual({
      logic: 'or',
      rows: [
        { variable: 'conv.step', operator: 'missing', value: '' },
        { variable: 'conv.step', operator: '!=', value: 'done' },
      ],
    });
  });

  it('gives up on shapes the rows cannot hold', () => {
    expect(conditionToRows({ '==': [1, 1] })).toBeNull();
    expect(conditionToRows({ '!': [{ '==': [{ var: 'a.b' }, 1] }] })).toBeNull();
    expect(conditionToRows({ and: [{ or: [{ missing: ['a.b'] }] }] })).toBeNull();
    expect(conditionToRows({ and: [] })).toBeNull();
  });
});

describe('rowsToCondition', () => {
  it('keeps literal types through a round trip', () => {
    for (const condition of [
      { '==': [{ var: 'conv.step' }, 'done'] },
      { '==': [{ var: 'conv.step' }, '42'] },
      { '>=': [{ var: 'sys.turn_index' }, 3] },
      { '==': [{ var: 'conv.flag' }, true] },
      { '!=': [{ var: 'result.house_id' }, null] },
      { in: [{ var: 'conv.step' }, ['a', 2]] },
      { in: [{ var: 'conv.step' }, { var: 'result.career_groups' }] },
      { and: [{ missing: ['conv.step'] }, { '<': [{ var: 'sys.turn_index' }, { var: 'conv.limit' }] }] },
    ]) {
      const rows = conditionToRows(condition);
      expect(rows).not.toBeNull();
      expect(rowsToCondition(rows!)).toEqual(condition);
    }
  });

  it('shows a string that looks like a number quoted, so it stays a string', () => {
    expect(conditionToRows({ '==': [{ var: 'conv.code' }, '42'] })?.rows[0]?.value).toBe('"42"');
  });

  it('stores no rows as an empty condition and one row without a wrapper', () => {
    expect(rowsToCondition({ logic: 'or', rows: [] })).toEqual({});
    expect(rowsToCondition({ logic: 'or', rows: [{ variable: 'conv.a', operator: '==', value: 'x' }] })).toEqual({
      '==': [{ var: 'conv.a' }, 'x'],
    });
  });
});

describe('formatCondition', () => {
  it('reads a condition in one line', () => {
    expect(formatCondition({ '==': [{ var: 'sys.turn_index' }, 0] })).toBe('sys.turn_index == 0');
    expect(
      formatCondition({ and: [{ '!=': [{ var: 'conv.step' }, 'done'] }, { or: [{ missing: ['conv.a'] }, { '>': [{ var: 'conv.n' }, 1] }] }] }),
    ).toBe('conv.step != "done" và (conv.a chưa có giá trị hoặc conv.n > 1)');
    expect(formatCondition({})).toBe('');
  });
});
