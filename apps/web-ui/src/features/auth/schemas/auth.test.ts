import { describe, it, expect } from 'vitest';
import { loginSchema, registerSchema } from './auth';

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

describe('registerSchema', () => {
  const base = { email: 'a@b.com', name: 'Ngân' };
  it('chấp nhận mật khẩu đủ chính sách backend', () => {
    expect(registerSchema.safeParse({ ...base, password: 'MatKhau1!' }).success).toBe(true);
  });
  it.each([
    ['thiếu chữ số', 'MatKhau!!'],
    ['thiếu chữ hoa', 'matkhau1!'],
    ['thiếu chữ thường', 'MATKHAU1!'],
    ['thiếu ký tự đặc biệt', 'MatKhau12'],
  ])('từ chối mật khẩu %s', (_, password) => {
    expect(registerSchema.safeParse({ ...base, password }).success).toBe(false);
  });
  it('đăng nhập không áp chính sách mật khẩu mới', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'matkhau123' }).success).toBe(true);
  });
});
