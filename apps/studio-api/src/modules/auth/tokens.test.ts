import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import legacy from '../../../tests/fixtures/legacy/auth.json';

const { issueAccessToken, issueRefreshToken, verifyToken } = await import('@/modules/auth/tokens');

function b64(json: unknown) {
  return Buffer.from(JSON.stringify(json)).toString('base64url');
}
function sign(header: unknown, payload: unknown, secret = legacy.secret) {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
}
function parts(token: string) {
  const [h, p] = token.split('.') as [string, string];
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString()),
  };
}
function tamper(token: string) {
  const [h, p, s] = token.split('.') as [string, string, string];
  const flipped = (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
  return `${h}.${p}.${flipped}`;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(legacy.clock * 1000);
  vi.stubEnv('SECRET_KEY', legacy.secret);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('HS256 verification and access contract migration', () => {
  it('verifies current user access and keeps refresh types separate', async () => {
    expect(await verifyToken(await issueAccessToken('7'), 'access')).toMatchObject({ sub: '7', type: 'access' });
    await expect(verifyToken(legacy.refresh_token, 'access')).rejects.toThrow();
  });

  it('verifies refresh as refresh but not access as refresh', async () => {
    expect(await verifyToken(legacy.refresh_token, 'refresh')).toEqual({
      sub: '7',
      type: 'refresh',
      exp: legacy.clock + legacy.refresh_ttl_minutes * 60,
    });
    await expect(verifyToken(legacy.access_token, 'refresh')).rejects.toThrow();
  });

  it('verifies current admin access with the admin flag', async () => {
    expect(await verifyToken(await issueAccessToken('admin', true), 'access')).toMatchObject({
      sub: 'admin',
      type: 'access',
      admin: true,
    });
  });

  it('rejects tampered signature, wrong secret and expired tokens', async () => {
    await expect(verifyToken(tamper(legacy.access_token), 'access')).rejects.toThrow();
    vi.stubEnv('SECRET_KEY', 'another-secret');
    await expect(verifyToken(legacy.access_token, 'access')).rejects.toThrow();
    vi.stubEnv('SECRET_KEY', legacy.secret);
    vi.setSystemTime((legacy.clock + legacy.access_ttl_minutes * 60 + 1) * 1000);
    await expect(verifyToken(legacy.access_token, 'access')).rejects.toThrow();
  });

  it('pins HS256: rejects alg none and other HMAC algorithms', async () => {
    const payload = { sub: '7', type: 'access', ver: 2, exp: legacy.clock + 60 };
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;
    await expect(verifyToken(none, 'access')).rejects.toThrow();
    const hs512Input = `${b64({ alg: 'HS512', typ: 'JWT' })}.${b64(payload)}`;
    const hs512 = `${hs512Input}.${createHmac('sha512', legacy.secret).update(hs512Input).digest('base64url')}`;
    await expect(verifyToken(hs512, 'access')).rejects.toThrow();
    // Same claims under HS256 are accepted (proves only alg made the difference).
    expect(await verifyToken(sign({ alg: 'HS256', typ: 'JWT' }, payload), 'access')).toMatchObject({ sub: '7' });
  });

  it('rejects tokens without exp, sub or type', async () => {
    const h = { alg: 'HS256', typ: 'JWT' };
    await expect(verifyToken(sign(h, { sub: '7', type: 'access' }), 'access')).rejects.toThrow();
    await expect(verifyToken(sign(h, { type: 'access', exp: legacy.clock + 60 }), 'access')).rejects.toThrow();
    await expect(verifyToken(sign(h, { sub: '7', exp: legacy.clock + 60 }), 'access')).rejects.toThrow();
  });
});

describe('issue*Token (versioned access and bounded lifetimes)', () => {
  it('access token: HS256, versioned {sub,exp,type}, TTL 1800s, raw UTF-8 secret', async () => {
    const token = await issueAccessToken('7');
    const { header, payload } = parts(token);
    expect(header.alg).toBe('HS256');
    expect(payload).toEqual({ sub: '7', type: 'access', ver: 2, exp: legacy.clock + 1800 });
    // Same HMAC as PyJWT with settings.SECRET_KEY as raw bytes.
    expect(token).toBe(sign(header, payload));
  });

  it('refresh token: exactly {sub,exp,type}, TTL 1209600s', async () => {
    const { payload } = parts(await issueRefreshToken('7'));
    expect(payload).toEqual({ sub: '7', type: 'refresh', exp: legacy.clock + 1209600 });
  });

  it('admin access token: {sub:admin, admin:true, type:access, exp}', async () => {
    const token = await issueAccessToken('admin', true);
    expect(parts(token).payload).toEqual({ sub: 'admin', admin: true, type: 'access', ver: 2, exp: legacy.clock + 1800 });
    expect(await verifyToken(token, 'access')).toMatchObject({ admin: true });
  });

  it('honours TTL env overrides', async () => {
    vi.stubEnv('ACCESS_TOKEN_EXPIRE_MINUTES', '15');
    expect(parts(await issueAccessToken('7')).payload.exp).toBe(legacy.clock + 900);
  });

  it('round-trips and keeps types apart', async () => {
    const refresh = await issueRefreshToken('9');
    await expect(verifyToken(refresh, 'access')).rejects.toThrow();
    expect(await verifyToken(refresh, 'refresh')).toMatchObject({ sub: '9', type: 'refresh' });
  });
});

it('invalidates previously issued long-lived access JWTs during the session security upgrade', async () => {
  await expect(verifyToken(legacy.access_token, 'access')).rejects.toMatchObject({code:'AUTH_INVALID_TOKEN'});
  await expect(verifyToken(legacy.admin_access_token, 'access')).rejects.toMatchObject({code:'AUTH_INVALID_TOKEN'});
});
