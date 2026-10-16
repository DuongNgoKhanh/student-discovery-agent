import { describe, it, expect } from 'vitest';
import { loginSchema } from './auth';

describe('loginSchema', () => {
  it('chấp nhận email + password ≥ 8', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '12345678' }).success).toBe(true);
  });
  it('từ chối password ngắn', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '123' }).success).toBe(false);
  });
  it('từ chối email sai định dạng', () => {
    expect(loginSchema.safeParse({ email: 'abc', password: '12345678' }).success).toBe(false);
  });
});
