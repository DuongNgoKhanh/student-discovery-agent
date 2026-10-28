import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { getKnowledgeEnv } from '@/config/env';
import { ProductError } from '@/http/errors';

export const RETRIEVAL_TARGET = '/api/v1/internal/knowledge/retrieval';
const TIMEOUT_MS = 3000;

export interface RetrievalPayload {
  knowledge_id: string;
  query: string;
  retrieval_setting: { top_k?: number; score_threshold?: number; semantic_weight?: number; max_chunks_per_doc?: number };
  metadata_condition?: unknown;
}

/** Token contract of the runtime ServiceVerifier: no owner, one purpose, bound to method + target + body. */
export async function signServiceRequest(
  method: string, target: string, body: string, key: Uint8Array, kid: string, nowMs = Date.now(),
): Promise<string> {
  const issuedAt = Math.floor(nowMs / 1000);
  return new SignJWT({
    caller_type: 'studio_service',
    purpose: 'knowledge.retrieval',
    method,
    request_target: target,
    body_sha256: createHash('sha256').update(body, 'utf8').digest('hex'),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'sda-internal+jwt', kid })
    .setIssuer('sda-studio-api')
    .setAudience('sda-agent-runtime')
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 30)
    .sign(key);
}

const unavailable = (kind: string) =>
  new ProductError(503, 'SYS_UNAVAILABLE', 'Knowledge search is unavailable', kind === 'dependency_down', { kind });

function signingKey(value: string | undefined): Uint8Array | null {
  if (!value) return null;
  const key = Buffer.from(value, 'base64');
  return key.length >= 32 && key.toString('base64') === value ? new Uint8Array(key) : null;
}

export async function retrieveKnowledge(
  payload: RetrievalPayload,
  ctx: { requestId: string; traceId: string },
): Promise<{ records: unknown[]; degraded: boolean }> {
  const env = getKnowledgeEnv();
  const key = signingKey(env.STUDIO_RUNTIME_SIGNING_KEY);
  if (!env.RUNTIME_INTERNAL_URL || !key) throw unavailable('not_configured');
  const body = JSON.stringify(payload);
  const token = await signServiceRequest('POST', RETRIEVAL_TARGET, body, key, env.STUDIO_RUNTIME_SIGNING_KID);
  let response: Response;
  try {
    response = await fetch(new URL(RETRIEVAL_TARGET, env.RUNTIME_INTERNAL_URL), {
      method: 'POST',
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'x-internal-caller': 'sda-studio-api',
        'x-caller-context': token,
        'x-request-id': ctx.requestId,
        'x-trace-id': ctx.traceId,
      },
    });
  } catch {
    throw unavailable('dependency_down');
  }
  const envelope = await response.json().catch(() => null) as { success?: boolean; data?: { records?: unknown[]; degraded?: boolean } } | null;
  if (response.ok && envelope?.success && Array.isArray(envelope.data?.records)) {
    return { records: envelope.data.records, degraded: envelope.data.degraded === true };
  }
  if (response.status === 404) throw new ProductError(404, 'RES_NOT_FOUND', 'Knowledge base not found');
  if (response.status === 422) throw new ProductError(422, 'VAL_INVALID_INPUT', 'Invalid search request', false, { kind: 'validation', issues: [] });
  console.error('[knowledge] retrieval failed', { status: response.status, requestId: ctx.requestId });
  throw unavailable('dependency_down');
}
