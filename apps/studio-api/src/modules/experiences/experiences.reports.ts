import { ProductError } from '@/http/errors';
import { getProductDatabase, type ProductDatabase } from '@/infrastructure/db/client';
import { findReportById, type ProductExecutor } from '@/modules/experiences/experiences.repository';
import {
  getExperienceRuntimeClient,
  type ExperienceRuntimeClient,
} from '@/modules/experiences/runtime-client';

export interface PublishReportInput {
  experience_id: string;
  definition_hash: string;
  definition_schema_version: string;
  engine_version: string;
  validation_id: string;
  evaluation_id: string;
}

export interface PublishReportVerdict {
  verified: boolean;
  reason?: string | null;
}

export interface PublishReportVerifier {
  /** True or verdict with reason only when both reports exist, passed, and were computed for this exact hash/schema/engine. */
  verify(input: PublishReportInput, executor?: ProductExecutor): Promise<boolean | PublishReportVerdict>;
}

export class RuntimeReportVerifier implements PublishReportVerifier {
  constructor(
    private readonly getDb: () => ProductDatabase = () => getProductDatabase(),
    private readonly getClient: () => ExperienceRuntimeClient = () => getExperienceRuntimeClient(),
  ) {}

  async verify(input: PublishReportInput, executor?: ProductExecutor): Promise<PublishReportVerdict> {
    let db: ProductExecutor;
    try {
      db = executor ?? this.getDb();
    } catch {
      return { verified: false, reason: 'Database not available for report verification' };
    }

    const val = await findReportById(db, input.validation_id);
    if (!val || val.kind !== 'validation') {
      return { verified: false, reason: `Validation report '${input.validation_id}' not found` };
    }
    if (val.status !== 'passed' || !val.mandatory_passed) {
      return { verified: false, reason: `Validation report '${input.validation_id}' did not pass` };
    }
    if (
      val.experience_id !== input.experience_id ||
      val.content_hash !== input.definition_hash ||
      val.definition_schema_version !== input.definition_schema_version ||
      val.engine_version !== input.engine_version
    ) {
      return { verified: false, reason: `Validation report does not match draft snapshot` };
    }

    const evalReport = await findReportById(db, input.evaluation_id);
    if (!evalReport || evalReport.kind !== 'evaluation') {
      return { verified: false, reason: `Evaluation report '${input.evaluation_id}' not found` };
    }
    if (evalReport.status !== 'passed' || !evalReport.mandatory_passed) {
      return { verified: false, reason: `Evaluation report '${input.evaluation_id}' did not pass mandatory cases` };
    }
    if (
      evalReport.experience_id !== input.experience_id ||
      evalReport.content_hash !== input.definition_hash ||
      evalReport.definition_schema_version !== input.definition_schema_version ||
      evalReport.engine_version !== input.engine_version
    ) {
      return { verified: false, reason: `Evaluation report does not match draft snapshot` };
    }

    try {
      const traceCtx = { requestId: `verify-${Date.now()}`, traceId: `verify-${Date.now()}` };
      const remote = await this.getClient().verify(input, traceCtx);
      if (!remote.verified) {
        return { verified: false, reason: remote.reason ?? 'Runtime verification rejected reports' };
      }
    } catch (err: unknown) {
      // An outage (5xx) must stay retryable instead of being reported as an invalid report.
      if (err instanceof ProductError && err.status >= 500) {
        throw err;
      }
      console.error('[experience-reports] runtime verification failed', {
        error: err instanceof Error ? err.name : 'Error',
      });
      return { verified: false, reason: 'Runtime verification failed' };
    }

    return { verified: true, reason: null };
  }
}

const defaultVerifier: PublishReportVerifier = new RuntimeReportVerifier();

let configuredVerifier: PublishReportVerifier = defaultVerifier;

export function getPublishReportVerifier(): PublishReportVerifier {
  return configuredVerifier;
}

/** Process-wide wiring point; `null` restores the default RuntimeReportVerifier. */
export function setPublishReportVerifier(verifier: PublishReportVerifier | null): void {
  configuredVerifier = verifier ?? defaultVerifier;
}
