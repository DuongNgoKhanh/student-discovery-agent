import { describe, it, expect } from 'vitest';
import { safeNext, withNext } from './safe-next';

describe('safeNext', () => {
  it('cho phép đường dẫn nội bộ', () => {
    expect(safeNext('/dashboard?x=1')).toBe('/dashboard?x=1');
  });
  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', 'dashboard', '', null, undefined])(
    'từ chối %s',
    (v) => expect(safeNext(v)).toBe('/dashboard'),
  );
});

describe('withNext', () => {
  it('chuyển tiếp next an toàn đã encode', () => {
    expect(withNext('/register', '/chat?x=1')).toBe('/register?next=%2Fchat%3Fx%3D1');
  });
  it.each(['//evil.com', 'https://evil.com', null])('bỏ next không an toàn: %s', (v) =>
    expect(withNext('/register', v)).toBe('/register'),
  );
});
