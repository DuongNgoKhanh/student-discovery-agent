/**
 * Publish-gate port for validation/evaluation reports (A-02/C-05).
 *
 * Until a report service exists, publish fails closed: a caller-supplied validation_id or
 * evaluation_id cannot be proven to be a passing report for this exact draft hash, schema and
 * engine, and releases are immutable once written. Wire a real verifier here when A-02/C-05 lands;
 * tests inject an accepting verifier explicitly.
 */
export interface PublishReportInput {
  experience_id: string;
  definition_hash: string;
  definition_schema_version: string;
  engine_version: string;
  validation_id: string;
  evaluation_id: string;
}

export interface PublishReportVerifier {
  /** True only when both reports exist, passed, and were computed for this exact hash/schema/engine. */
  verify(input: PublishReportInput): Promise<boolean>;
}

const unavailableVerifier: PublishReportVerifier = { verify: async () => false };

let configuredVerifier: PublishReportVerifier = unavailableVerifier;

export function getPublishReportVerifier(): PublishReportVerifier {
  return configuredVerifier;
}

/** Process-wide wiring point; `null` restores the fail-closed default. */
export function setPublishReportVerifier(verifier: PublishReportVerifier | null): void {
  configuredVerifier = verifier ?? unavailableVerifier;
}
