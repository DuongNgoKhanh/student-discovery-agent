import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyDeliveryRequest } from '@/modules/agent/delivery-auth';

const KEY = Buffer.alloc(32, 4);
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
  it('is 503 when no verify key is configured', async () => {
    vi.stubEnv('PRODUCT_DELIVERY_VERIFY_KEY', '');
    await expect(verifyDeliveryRequest(request(await token()), '')).rejects.toMatchObject({ status: 503 });
  });
});
