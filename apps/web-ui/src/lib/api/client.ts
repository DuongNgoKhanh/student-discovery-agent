import { unwrap } from './response';

const BASE = '/api/v1';

// Auth-establishing endpoints: a 401 here is a real failure, never refresh+retry.
const NO_RETRY = new Set(['auth/login', 'auth/register', 'admin/auth/login', 'auth/refresh', 'auth/logout']);

/** Renew the access cookie via the httpOnly refresh cookie. Never touches tokens in JS. */
let pendingRefresh: Promise<boolean> | undefined;
export function refreshSession(): Promise<boolean> {
  if (pendingRefresh) return pendingRefresh;
  // Web Locks are shared by every tab on this origin. Cookie updates finish before
  // fetch resolves, so the next lock holder sends the newly rotated credential.
  // Older/insecure browser contexts must log in again instead of racing refresh.
  if (typeof navigator === 'undefined' || !navigator.locks) return Promise.resolve(false);
  return pendingRefresh = Promise.resolve(navigator.locks.request('sda-auth-refresh', renewSession))
    .catch(() => false).finally(() => { pendingRefresh = undefined; });
}
async function renewSession(): Promise<boolean> {
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
 * On AUTH_TOKEN_EXPIRED for an authenticated request: refresh once, then retry once with the same body.
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
  let expired = false;
  if (res.status === 401 && !NO_RETRY.has(path.split('?')[0] ?? path)) {
    try { expired = (await res.clone().json()).error?.code === 'AUTH_TOKEN_EXPIRED'; } catch { /* unwrap reports malformed responses */ }
  }
  if (expired && (await refreshSession())) {
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
