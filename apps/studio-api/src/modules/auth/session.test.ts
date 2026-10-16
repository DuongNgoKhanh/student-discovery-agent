import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import legacy from '../../../tests/fixtures/legacy/auth.json';
import { createApp } from '@/app';

const app = createApp();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(legacy.clock * 1000);
  vi.stubEnv('SECRET_KEY', legacy.secret);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it.each([
  [legacy.access_token, { userId: '7', isAdmin: false }],
  [legacy.admin_access_token, { userId: 'admin', isAdmin: true }],
])('returns a verified session without exposing or rotating credentials', async (token, expected) => {
  const response = await app.request('/api/v1/auth/session', { headers: { cookie: `sda_access=${token}` } });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual(expected);
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('rejects missing, malformed and refresh-typed access credentials', async () => {
  for (const token of ['', 'invalid', legacy.refresh_token]) {
    const response = await app.request('/api/v1/auth/session', { headers: { cookie: `sda_access=${token}` } });
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('AUTH_INVALID_TOKEN');
  }
});

it('rejects expired access cookies', async () => {
  vi.setSystemTime((legacy.clock + legacy.access_ttl_minutes * 60 + 1) * 1000);
  const response = await app.request('/api/v1/auth/session', { headers: { cookie: `sda_access=${legacy.access_token}` } });
  expect(response.status).toBe(401);
});

it('honors explicit Bearer credentials and never falls back from invalid Bearer to a valid cookie', async () => {
  const response = await app.request('/api/v1/auth/session', { headers: { authorization: `Bearer ${legacy.access_token}` } });
  expect(response.status).toBe(200);
  const invalid = await app.request('/api/v1/auth/session', {
    headers: { authorization: 'Bearer invalid', cookie: `sda_access=${legacy.admin_access_token}` },
  });
  expect(invalid.status).toBe(401);
});

it('reports missing server configuration as 500 rather than logged out', async () => {
  vi.stubEnv('SECRET_KEY', '');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await app.request('/api/v1/auth/session', { headers: { cookie: `sda_access=${legacy.access_token}` } });
    expect(response.status).toBe(500);
  } finally { log.mockRestore(); }
});
