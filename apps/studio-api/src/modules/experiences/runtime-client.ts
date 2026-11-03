import { z } from 'zod';
import { getKnowledgeEnv } from '@/config/env';
import { ProductError } from '@/http/errors';
import type { RequestContext } from '@/http/types';
import { signingKey, signServiceRequest } from '@/modules/knowledge/runtime-client';
import type { PublishReportInput } from '@/modules/experiences/experiences.reports';

export const VALIDATE_TARGET = '/api/v1/internal/experience-validations:run';
export const EVALUATE_TARGET = '/api/v1/internal/experience-evaluations:run';
export const VERIFY_TARGET = '/api/v1/internal/experience-reports:verify';

const TIMEOUT_MS = 5000;

export const validationIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
  rule_id: z.string().nullable().optional(),
});

export const validationReportSchema = z.object({
  id: z.string(),
  experience_id: z.string(),
  draft_revision: z.number().int().nonnegative(),
  content_hash: z.string(),
  definition_schema_version: z.string(),
  engine_version: z.string(),
  status: z.enum(['passed', 'failed', 'unsupported']),
  mandatory_passed: z.boolean(),
  issues: z.array(validationIssueSchema),
  created_at: z.string(),
});
export type ValidationReport = z.infer<typeof validationReportSchema>;

export const evaluationCaseResultSchema = z.object({
  case_id: z.string(),
  mandatory: z.boolean(),
  passed: z.boolean(),
  expected: z.record(z.unknown()),
  actual: z.record(z.unknown()),
  issues: z.array(validationIssueSchema),
});

export const evaluationReportSchema = z.object({
  id: z.string(),
  experience_id: z.string(),
  draft_revision: z.number().int().nonnegative(),
  content_hash: z.string(),
  definition_schema_version: z.string(),
  engine_version: z.string(),
  status: z.enum(['passed', 'failed', 'unsupported']),
  mandatory_passed: z.boolean(),
  cases: z.array(evaluationCaseResultSchema),
  created_at: z.string(),
});
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;

export const verifyReportResultSchema = z.object({
  verified: z.boolean(),
  reason: z.string().nullable(),
});
export type VerifyReportResult = z.infer<typeof verifyReportResultSchema>;

export interface ExperienceSnapshotCommandInput {
  experience_id: string;
  definition: Record<string, unknown>;
  expected_revision: number;
  content_hash: string;
  idempotency_key: string;
}

const unavailable = (
  kind: 'dependency_down' | 'timeout' | 'not_configured' | 'misconfigured',
  message = 'Experience validation service is unavailable',
) => new ProductError(503, 'SYS_UNAVAILABLE', message, kind === 'dependency_down' || kind === 'timeout', { kind });

async function callRuntime<T>(
  target: string,
  purpose: string,
  payload: unknown,
  schema: z.ZodType<T>,
  ctx: RequestContext,
): Promise<T> {
  const env = getKnowledgeEnv();
  const key = signingKey(env.STUDIO_RUNTIME_SIGNING_KEY);
  if (!env.RUNTIME_INTERNAL_URL || !key) {
    throw unavailable('not_configured');
  }

  const body = JSON.stringify(payload);
  const token = await signServiceRequest(
    'POST',
    target,
    body,
    key,
    env.STUDIO_RUNTIME_SIGNING_KID,
    Date.now(),
    purpose,
  );

  let response: Response;
  try {
    response = await fetch(new URL(target, env.RUNTIME_INTERNAL_URL), {
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
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error';
    console.error('[experience-runtime] request unreachable', {
      target,
      purpose,
      error: name,
      requestId: ctx.requestId,
    });
    throw unavailable(name === 'TimeoutError' ? 'timeout' : 'dependency_down');
  }

  const envelope = (await response.json().catch(() => null)) as {
    success?: boolean;
    data?: unknown;
    error?: { code?: string; message?: string };
  } | null;

  if (response.ok && envelope?.success) {
    const parsed = schema.safeParse(envelope.data);
    if (parsed.success) {
      return parsed.data;
    }
    console.error('[experience-runtime] malformed payload from runtime', {
      target,
      issues: parsed.error.issues,
      requestId: ctx.requestId,
    });
    throw unavailable('dependency_down', 'Malformed report received from runtime');
  }

  const runtimeCode = envelope?.error?.code ?? null;
  console.error('[experience-runtime] request failed', {
    target,
    status: response.status,
    runtimeCode,
    requestId: ctx.requestId,
  });

  if (response.status === 401 || response.status === 403) {
    throw unavailable('misconfigured');
  }
  if (response.status === 409) {
    const code = runtimeCode === 'IDEMPOTENCY_KEY_COLLISION' ? 'IDEMPOTENCY_KEY_COLLISION' : 'REVISION_CONFLICT';
    throw new ProductError(409, code, envelope?.error?.message ?? 'Runtime reported conflict');
  }
  if (response.status >= 400 && response.status < 500) {
    throw new ProductError(500, 'SYS_INTERNAL_ERROR', 'Runtime rejected experience request', false, {
      kind: 'runtime_rejected',
    });
  }
  throw unavailable('dependency_down');
}

export const defaultExperienceRuntimeClient = {
  validate(cmd: ExperienceSnapshotCommandInput, ctx: RequestContext): Promise<ValidationReport> {
    return callRuntime(VALIDATE_TARGET, 'experience.validate', cmd, validationReportSchema, ctx);
  },
  evaluate(cmd: ExperienceSnapshotCommandInput, ctx: RequestContext): Promise<EvaluationReport> {
    return callRuntime(EVALUATE_TARGET, 'experience.evaluate', cmd, evaluationReportSchema, ctx);
  },
  verify(input: PublishReportInput, ctx: RequestContext): Promise<VerifyReportResult> {
    return callRuntime(VERIFY_TARGET, 'experience.verify', input, verifyReportResultSchema, ctx);
  },
};

export type ExperienceRuntimeClient = typeof defaultExperienceRuntimeClient;

let activeClient: ExperienceRuntimeClient = defaultExperienceRuntimeClient;

export function setExperienceRuntimeClient(client: ExperienceRuntimeClient | null): void {
  activeClient = client ?? defaultExperienceRuntimeClient;
}

export function getExperienceRuntimeClient(): ExperienceRuntimeClient {
  return activeClient;
}
