import { describe, expect, it } from 'vitest';
import { fromDateTimeLocal, fromFormValues, toDateTimeLocal, toFormValues } from './metadata-form';

const FIELDS = [
  { id: 'f1', name: 'province', type: 'string', label: 'Tỉnh', filterable: true, ordinal: 0 },
  { id: 'f2', name: 'fee', type: 'number', label: '', filterable: false, ordinal: 1 },
  { id: 'f3', name: 'houses', type: 'string_list', label: '', filterable: true, ordinal: 2 },
  { id: 'f4', name: 'updated', type: 'time', label: '', filterable: false, ordinal: 3 },
] as const;

describe('metadata form', () => {
  it('round-trips typed values through text inputs', () => {
    const values = toFormValues([...FIELDS], { province: 'Huế', fee: 25.5, houses: ['E', 'C'] });
    expect(values).toEqual({ province: 'Huế', fee: '25.5', houses: 'E; C', updated: '' });
    expect(fromFormValues([...FIELDS], { ...values, houses: ' E ;; C ', updated: '2026-03-01' })).toEqual({
      metadata: { province: 'Huế', fee: 25.5, houses: ['E', 'C'], updated: '2026-03-01' }, errors: [], issues: {},
    });
  });
  it('drops empty inputs and reports bad numbers and times per field', () => {
    expect(fromFormValues([...FIELDS], { province: '', fee: 'abc', houses: '', updated: '1/3/2026' })).toEqual({
      metadata: {},
      errors: ['fee: không phải số', 'updated: không phải ngày giờ hợp lệ'],
      issues: { fee: 'không phải số', updated: 'không phải ngày giờ hợp lệ' },
    });
  });
  it('maps times onto datetime-local and keeps date-only values date-only', () => {
    expect(toDateTimeLocal('2026-03-01')).toBe('2026-03-01T00:00');
    expect(toDateTimeLocal('2026-03-01 10:30')).toBe('2026-03-01T10:30');
    expect(toDateTimeLocal('2026-03-01T10:30:00+07:00')).toBeNull();
    expect(fromDateTimeLocal('2026-03-01T00:00')).toBe('2026-03-01');
    expect(fromDateTimeLocal('2026-03-01T10:30')).toBe('2026-03-01T10:30');
  });
});
