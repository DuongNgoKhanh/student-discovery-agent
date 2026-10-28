import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { getConversationEnv } from '@/config/env';
import { ProductError } from '@/http/errors';
import type { RequestContext } from '@/http/types';

export const INTERNAL_PREFIX = '/api/v1/internal';
// A turn may call the model and tools; the runtime commits it even if we give up, so this only bounds the wait.
const TIMEOUT_MS = 90_000;

/** Student caller context of the runtime CallerVerifier, bound to method, raw target and body. */
export async function signStudentRequest(
  method: string, target: string, body: string, ownerId: string, key: Uint8Array, kid: string, nowMs = Date.now(),
): Promise<string> {
  const issuedAt = Math.floor(nowMs / 1000);
  return new SignJWT({
    caller_type: 'student',
    owner_id: ownerId,
    method,
    request_target: target,
    body_sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'sda-internal+jwt', kid })
    .setIssuer('sda-product-bff')
    .setAudience('sda-agent-runtime')
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 60)
    .sign(key);
}

const unavailable = (kind: string) =>
  new ProductError(503, 'SYS_UNAVAILABLE', 'Conversation service is unavailable', kind === 'dependency_down', { kind });

function signingKey(value: string | undefined): Uint8Array | null {
  if (!value) return null;
  const key = Buffer.from(value, 'base64');
  return key.length >= 32 && key.toString('base64') === value ? new Uint8Array(key) : null;
}

/**
 * Forward one student request to the runtime and hand its envelope back unchanged: the runtime already speaks
 * the public ApiResponse contract, and re-wrapping would lose its error codes and details.
 */
export async function forwardToRuntime(
  method: 'GET' | 'POST', path: string, body: string, ownerId: string, ctx: RequestContext,
): Promise<Response> {
  const env = getConversationEnv();
  const key = signingKey(env.PRODUCT_RUNTIME_SIGNING_KEY);
  if (!env.RUNTIME_INTERNAL_URL || !key) throw unavailable('not_configured');
  const target = INTERNAL_PREFIX + path;
  const token = await signStudentRequest(method, target, body, ownerId, key, env.PRODUCT_RUNTIME_SIGNING_KID);
  let response: Response;
  try {
    response = await fetch(new URL(target, env.RUNTIME_INTERNAL_URL), {
      method,
      body: method === 'POST' ? body : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        'x-internal-caller': 'sda-product-bff',
        'x-caller-context': token,
        'x-request-id': ctx.requestId,
        'x-trace-id': ctx.traceId,
      },
    });
  } catch {
    throw unavailable('dependency_down');
  }
  const text = await response.text();
  if (!response.headers.get('content-type')?.includes('application/json')) {
    console.error('[conversations] non-JSON runtime response', { status: response.status, requestId: ctx.requestId });
    throw unavailable('dependency_down');
  }
  return new Response(text, { status: response.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
