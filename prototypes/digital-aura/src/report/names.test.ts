import { describe, expect, it } from 'vitest';
import { withoutFamilyName } from './names';

describe('withoutFamilyName', () => {
  it('drops a leading Vietnamese family name', () => {
    expect(withoutFamilyName('Nguyễn Minh An')).toBe('Minh An');
    expect(withoutFamilyName('Lê An')).toBe('An');
    expect(withoutFamilyName('  trần   thị   mai ')).toBe('thị mai');
  });

  it('keeps names that start with a given name', () => {
    expect(withoutFamilyName('Khánh Linh')).toBe('Khánh Linh');
    expect(withoutFamilyName('Thảo Vy')).toBe('Thảo Vy');
    expect(withoutFamilyName('Ngân')).toBe('Ngân');
  });
});
