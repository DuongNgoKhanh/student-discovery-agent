import { createHash } from 'node:crypto';
import { decodeProtectedHeader, jwtVerify } from 'jose';
import { getAgentEnv } from '@/config/env';
import { ProductError } from '@/http/errors';
import { signingKey } from '@/modules/knowledge/runtime-client';

const MAX_CLOCK_SKEW_SECONDS = 30;
const invalid = () => new ProductError(401, 'AUTH_CALLER_CONTEXT_INVALID', 'Invalid caller context');

/** Runtime -> studio-api only: one key, one purpose, bound to method, raw target and body. */
export async function verifyDeliveryRequest(req: Request, body: string): Promise<void> {
  const env = getAgentEnv();
  const key = signingKey(env.PRODUCT_DELIVERY_VERIFY_KEY);
  if (!key) throw new ProductError(503, 'SYS_UNAVAILABLE', 'Release delivery is not configured', false, { kind: 'not_configured' });
  const token = req.headers.get('x-caller-context');
  if (req.headers.get('x-internal-caller') !== 'sda-agent-runtime' || !token || token.length > 8192) throw invalid();
  let payload: Record<string, unknown>;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== 'HS256' || header.typ !== 'sda-internal+jwt' || header.kid !== env.PRODUCT_DELIVERY_VERIFY_KID) throw invalid();
    ({ payload } = await jwtVerify(token, key, { issuer: 'sda-agent-runtime', audience: 'sda-studio-api', algorithms: ['HS256'] }));
  } catch {
    throw invalid();
  }
  const url = new URL(req.url);
  const iat = payload.iat as number | undefined;
  const exp = payload.exp as number | undefined;
  if (typeof iat !== 'number' || typeof exp !== 'number' || exp - iat > 60 || iat > Math.floor(Date.now() / 1000) + MAX_CLOCK_SKEW_SECONDS
    || payload.method !== req.method || payload.request_target !== url.pathname + url.search
    || payload.body_sha256 !== createHash('sha256').update(body, 'utf8').digest('hex')) throw invalid();
  if (payload.caller_type !== 'runtime_service' || payload.purpose !== 'release.delivery') {
    throw new ProductError(403, 'AUTHZ_FORBIDDEN', 'Caller may not read releases');
  }
}
