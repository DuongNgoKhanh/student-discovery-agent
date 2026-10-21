import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import legacy from '../../../tests/fixtures/legacy/auth.json';
import { createApp } from '@/app';

import { issueAccessToken, issueRefreshToken } from './tokens';
let access: string; let admin: string; let refresh: string;
const app = createApp();
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(legacy.clock * 1000);
  vi.stubEnv('SECRET_KEY', legacy.secret);
  access = await issueAccessToken('7'); admin = await issueAccessToken('admin', true); refresh = await issueRefreshToken('7');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it.each([
  ['user', { principal: { type: 'user', id: '7' }, is_admin: false }],
  ['admin', { principal: { type: 'admin', id: 'admin' }, is_admin: true }],
])('returns a verified session without exposing or rotating credentials', async (token, expected) => {
  const response = await app.request('/api/v1/auth/session', { headers: { cookie: `sda_access=${token === 'user' ? access : admin}` } });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual(expected);
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('rejects missing, malformed and refresh-typed access credentials', async () => {
  for (const token of ['', 'invalid', refresh]) {
    const response = await app.request('/api/v1/auth/session', { headers: { cookie: `sda_access=${token}` } });
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe(token ? 'AUTH_TOKEN_INVALID' : 'AUTH_TOKEN_MISSING');
  }
});

it('rejects expired access cookies', async () => {
  vi.setSystemTime((legacy.clock + legacy.access_ttl_minutes * 60 + 1) * 1000);
  const response = await app.request('/api/v1/auth/session', { headers: { cookie: `sda_access=${access}` } });
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe('AUTH_TOKEN_EXPIRED');
});

it('honors explicit Bearer credentials and never falls back from invalid Bearer to a valid cookie', async () => {
  const response = await app.request('/api/v1/auth/session', { headers: { authorization: `Bearer ${access}` } });
  expect(response.status).toBe(200);
  const invalid = await app.request('/api/v1/auth/session', {
    headers: { authorization: 'Bearer invalid', cookie: `sda_access=${admin}` },
  });
  expect(invalid.status).toBe(401);
});

it('reports missing server configuration as 500 rather than logged out', async () => {
  vi.stubEnv('SECRET_KEY', '');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await app.request('/api/v1/auth/session', { headers: { cookie: `sda_access=${access}` } });
    expect(response.status).toBe(500);
  } finally { log.mockRestore(); }
});

it('rejects access credentials whose subject cannot form the typed session principal', async () => {
  const response = await app.request('/api/v1/auth/session', { headers: { authorization: `Bearer ${await issueAccessToken('arbitrary-name')}` } });
  expect(response.status).toBe(401);
  expect((await response.json()).error.code).toBe('AUTH_TOKEN_INVALID');
});
