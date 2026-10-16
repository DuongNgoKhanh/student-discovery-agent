import { api } from '@/lib/api/client';
import type { AdminLoginInput, LoginInput, RegisterInput } from '../schemas/auth';

/**
 * Gọi Product API (/api/v1/auth/*). Server set/xoá httpOnly cookie;
 * UI không lưu token (không localStorage), bỏ qua token trong response body.
 */
export async function login(input: LoginInput): Promise<void> {
  await api.post('auth/login', input);
}

export async function register(input: RegisterInput): Promise<void> {
  await api.post('auth/register', input);
}

export async function adminLogin(input: AdminLoginInput): Promise<void> {
  await api.post('admin/auth/login', input);
}

export async function logout(): Promise<void> {
  await api.post('auth/logout');
}
