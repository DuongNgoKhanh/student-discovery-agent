import { unwrap } from './response';

const BASE = '/api/v1';

// Auth-establishing endpoints: a 401 here is a real failure, never refresh+retry.
const NO_RETRY = new Set(['auth/login', 'auth/register', 'admin/auth/login', 'auth/refresh']);

/** Renew the access cookie via the httpOnly refresh cookie. Never touches tokens in JS. */
export async function refreshSession(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      credentials: 'same-origin',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Browser API client: same-origin calls to the Product API (/api/v1), cookies are httpOnly.
 * Unwraps the envelope. `path` is the part after /api/v1, e.g. 'me', 'admin/users?page=1'.
 * On 401 for an authenticated request: refresh once, then retry once with the same body.
 */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const serialized = body !== undefined ? JSON.stringify(body) : undefined;
  const send = () =>
    fetch(`${BASE}/${path}`, {
      method,
      headers: serialized !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: serialized,
      credentials: 'same-origin',
    });

  let res = await send();
  if (res.status === 401 && !NO_RETRY.has(path.split('?')[0] ?? path) && (await refreshSession())) {
    res = await send();
  }
  return unwrap<T>(res);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
