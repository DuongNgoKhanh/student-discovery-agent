import { unwrap } from './response';

const BFF = '/api/bff';

/**
 * API client dùng ở CLIENT component. Luôn gọi same-origin qua BFF proxy
 * (không gọi thẳng FastAPI — token nằm ở httpOnly cookie). Tự unwrap envelope.
 * `path` là phần sau /api/v1, ví dụ: 'me', 'admin/users?page=1'.
 */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BFF}/${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return unwrap<T>(res);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
