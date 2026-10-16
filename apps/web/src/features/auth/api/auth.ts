import type { LoginInput, RegisterInput } from '../schemas/auth';

/**
 * Gọi các route handler auth (same-origin) — nơi set/xoá httpOnly cookie.
 * KHÔNG gọi thẳng FastAPI ở đây.
 */
async function postAuth(path: string, body: unknown, fallback: string): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error?.message ?? fallback);
}

export function login(input: LoginInput): Promise<void> {
  return postAuth('/api/auth/login', input, 'Đăng nhập thất bại');
}

export function register(input: RegisterInput): Promise<void> {
  return postAuth('/api/auth/register', input, 'Đăng ký thất bại');
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}
