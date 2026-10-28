import { z } from 'zod';
import { getKnowledgeEnv } from '@/config/env';
import { ProductError } from '@/http/errors';
import type { RequestContext } from '@/http/types';
import { signingKey, signServiceRequest } from '@/modules/knowledge/runtime-client';

export const VALIDATE_TARGET = '/api/v1/internal/agent-snapshots:validate';
const TIMEOUT_MS = 5000;

const reportSchema = z.object({
  valid: z.boolean(),
  content_hash: z.string(),
  issues: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })),
});
export type AgentValidation = z.infer<typeof reportSchema>;
export type AgentIssue = AgentValidation['issues'][number];

const unavailable = (kind: string) =>
  new ProductError(503, 'SYS_UNAVAILABLE', 'Agent validation is unavailable', kind === 'dependency_down', { kind });

/** The runtime owns agent schema rules; anything short of a well-formed report is a failure, never a pass. */
export async function validateWithRuntime(content: Record<string, unknown>, ctx: RequestContext): Promise<AgentValidation> {
  const env = getKnowledgeEnv();
  const key = signingKey(env.STUDIO_RUNTIME_SIGNING_KEY);
  if (!env.RUNTIME_INTERNAL_URL || !key) throw unavailable('not_configured');
  const body = JSON.stringify({ content });
  const token = await signServiceRequest('POST', VALIDATE_TARGET, body, key, env.STUDIO_RUNTIME_SIGNING_KID, Date.now(), 'agent.validate');
  let response: Response;
  try {
    response = await fetch(new URL(VALIDATE_TARGET, env.RUNTIME_INTERNAL_URL), {
      method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json', 'x-internal-caller': 'sda-studio-api', 'x-caller-context': token,
        'x-request-id': ctx.requestId, 'x-trace-id': ctx.traceId,
      },
    });
  } catch {
    throw unavailable('dependency_down');
  }
  const envelope = await response.json().catch(() => null) as { success?: boolean; data?: unknown } | null;
  const parsed = response.ok && envelope?.success ? reportSchema.safeParse(envelope.data) : null;
  if (!parsed?.success) {
    console.error('[agent] runtime validation failed', { status: response.status, requestId: ctx.requestId });
    throw unavailable('dependency_down');
  }
  return parsed.data;
}

type Validator = typeof validateWithRuntime;
let current: Validator = validateWithRuntime;
/** Test seam: integration tests replace the runtime call; `null` restores the real client. */
export function setAgentValidator(fn: Validator | null): void { current = fn ?? validateWithRuntime; }
export const getAgentValidator = (): Validator => current;
