import { describe, it, expect } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('cho phép đường dẫn nội bộ', () => {
    expect(safeNext('/dashboard?x=1')).toBe('/dashboard?x=1');
  });
  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', 'dashboard', '', null, undefined])(
    'từ chối %s',
    (v) => expect(safeNext(v)).toBe('/dashboard'),
  );
});
