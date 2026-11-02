import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyDeliveryRequest } from '@/modules/agent/delivery-auth';

const KEY = Buffer.alloc(32, 4);
const GOLDEN = JSON.parse(readFileSync(resolve(__dirname, '../../../../../contracts/fixtures/runtime-delivery-token.json'), 'utf8')) as {
  key_base64: string; kid: string; now: number; cases: Array<{ environment: string; target: string; token: string }>;
};
const TARGET = '/api/v1/internal/releases/active?kind=agent&environment=demo';

async function token(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}, key = KEY, skew = 0) {
  const now = Math.floor(Date.now() / 1000) + skew;
  return new SignJWT({ caller_type: 'runtime_service', purpose: 'release.delivery', method: 'GET', request_target: TARGET,
    body_sha256: createHash('sha256').update('').digest('hex'), ...overrides })
    .setProtectedHeader({ alg: 'HS256', typ: 'sda-internal+jwt', kid: 'runtime', ...header })
    .setIssuer('sda-agent-runtime').setAudience('sda-studio-api').setIssuedAt(now).setExpirationTime(now + 60)
    .sign(new Uint8Array(key));
}
const request = (jwt: string, target = TARGET, caller = 'sda-agent-runtime') =>
  new Request(`http://studio-api:3001${target}`, { headers: { 'x-internal-caller': caller, 'x-caller-context': jwt } });

beforeEach(() => vi.stubEnv('PRODUCT_DELIVERY_VERIFY_KEY', KEY.toString('base64')));
afterEach(() => vi.unstubAllEnvs());

describe('verifyDeliveryRequest', () => {
  it('accepts a bound runtime token', async () => {
    await expect(verifyDeliveryRequest(request(await token()), '')).resolves.toBeUndefined();
  });
  it.each([
    ['wrong key', async () => request(await token({}, {}, Buffer.alloc(32, 5)))],
    ['other target', async () => request(await token({ request_target: '/api/v1/internal/releases/active?kind=agent' }))],
    ['unknown kid', async () => request(await token({}, { kid: 'other' }))],
    ['missing caller header', async () => request(await token(), TARGET, 'sda-studio-api')],
    ['iat beyond the 30s clock skew', async () => request(await token({}, {}, KEY, 31))],
  ])('rejects %s with 401', async (_n, build) => {
    await expect(verifyDeliveryRequest(await build(), '')).rejects.toMatchObject({ status: 401 });
  });
  it('tolerates iat within the 30s clock skew', async () => {
    await expect(verifyDeliveryRequest(request(await token({}, {}, KEY, 25)), '')).resolves.toBeUndefined();
  });
  it('rejects another purpose with 403', async () => {
    await expect(verifyDeliveryRequest(request(await token({ purpose: 'agent.validate' })), '')).rejects.toMatchObject({ status: 403 });
  });
  it.each([
    ['another method', async () => new Request(`http://studio-api:3001${TARGET}`, {
      method: 'POST', body: '', headers: { 'x-internal-caller': 'sda-agent-runtime', 'x-caller-context': await token() } })],
    ['a lifetime over 60s', async () => {
      const now = Math.floor(Date.now() / 1000);
      return request(await new SignJWT({ caller_type: 'runtime_service', purpose: 'release.delivery', method: 'GET', request_target: TARGET,
        body_sha256: createHash('sha256').update('').digest('hex') })
        .setProtectedHeader({ alg: 'HS256', typ: 'sda-internal+jwt', kid: 'runtime' })
        .setIssuer('sda-agent-runtime').setAudience('sda-studio-api').setIssuedAt(now).setExpirationTime(now + 61)
        .sign(new Uint8Array(KEY)));
    }],
    ['another typ', async () => request(await token({}, { typ: 'JWT' }))],
    ['another alg', async () => request(await new SignJWT({}).setProtectedHeader({ alg: 'HS384', typ: 'sda-internal+jwt', kid: 'runtime' })
      .sign(new Uint8Array(KEY)))],
    ['an oversized token', async () => request('a'.repeat(8193))],
  ])('rejects %s with 401', async (_n, build) => {
    await expect(verifyDeliveryRequest(await build(), '')).rejects.toMatchObject({ status: 401 });
  });
  it('rejects a body that does not match body_sha256 with 401', async () => {
    await expect(verifyDeliveryRequest(request(await token()), '{"x":1}')).rejects.toMatchObject({ status: 401 });
  });
  it('rejects a non-runtime caller_type with 403', async () => {
    await expect(verifyDeliveryRequest(request(await token({ caller_type: 'student' })), '')).rejects.toMatchObject({ status: 403 });
  });
  it.each(GOLDEN.cases.map(c => [c.environment, c] as const))('accepts the token agent-runtime signs for %s', async (_env, golden) => {
    // contracts/fixtures/runtime-delivery-token.json is produced by agent-runtime delivery.py; its test checks the same bytes.
    vi.useFakeTimers({ now: GOLDEN.now * 1000 });
    try {
      vi.stubEnv('PRODUCT_DELIVERY_VERIFY_KEY', GOLDEN.key_base64);
      vi.stubEnv('PRODUCT_DELIVERY_VERIFY_KID', GOLDEN.kid);
      await expect(verifyDeliveryRequest(request(golden.token, golden.target), '')).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
  it('is 503 when no verify key is configured', async () => {
    vi.stubEnv('PRODUCT_DELIVERY_VERIFY_KEY', '');
    await expect(verifyDeliveryRequest(request(await token()), '')).rejects.toMatchObject({ status: 503 });
  });
});
