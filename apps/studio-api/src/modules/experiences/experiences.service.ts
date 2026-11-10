import { randomBytes } from 'node:crypto';
import type { ProductDatabase } from '@/infrastructure/db/client';
import { ProductError } from '@/http/errors';
import type { RequestContext } from '@/http/types';
import { computeContentHash } from '@/modules/experiences/canonical';
import {
  findDraftByExperienceId,
  findExperienceById,
  findExperienceWithDraft,
  findIdempotencyRecord,
  findReleaseById,
  insertExperienceRelease,
  insertExperienceReport,
  insertExperienceWithDraft,
  listExperienceReleases as repoListReleases,
  listExperiences as repoListExperiences,
  patchExperienceMetadata,
  saveIdempotencyRecord,
  updateDraftContent,
  withIdempotencyLock,
  type ProductExecutor,
} from '@/modules/experiences/experiences.repository';
import { getPublishReportVerifier, type PublishReportVerifier } from '@/modules/experiences/experiences.reports';
import {
  getExperienceRuntimeClient,
  type EvaluationReport,
  type ValidationReport,
} from '@/modules/experiences/runtime-client';
import {
  experienceDefinitionStructuralSchema,
  toExperienceDraftDTO,
  toExperienceMetadataDTO,
  toExperienceReleaseDTO,
  type CreateExperienceInput,
  type ExperienceDraftDTO,
  type ExperienceMetadataDTO,
  type ExperienceReleaseDTO,
  type PaginationQuery,
  type PatchExperienceInput,
  type PublishReleaseInput,
  type SnapshotCommandInput,
} from '@/modules/experiences/experiences.schemas';

export interface ServiceResult<T> {
  status: number;
  data: T;
  replayed?: boolean;
}

/** Keep the persisted semantic fingerprint independent of public revision field names. */
function revisionPayloadHashes(
  payload: Record<string, unknown>,
  wireField: 'expected_metadata_revision' | 'expected_draft_revision',
): readonly string[] {
  const { expected_revision, ...rest } = payload;
  return [
    computeContentHash(payload),
    // Accept records written during the explicit-field rollout, with identical semantic values only.
    computeContentHash({ ...rest, [wireField]: expected_revision }),
  ];
}

/** Adapt only DTO revision fields; historical payloads and counters remain the committed result. */
function replayResponse(scope: string, stored: Record<string, unknown>): Record<string, unknown> {
  const rename = (value: Record<string, unknown>, field: string) => {
    if (!Object.hasOwn(value, 'revision')) return value;
    const { revision, ...rest } = value;
    return { ...rest, [field]: Object.hasOwn(rest, field) ? rest[field] : revision };
  };
  if (scope === 'create_experience' || scope.startsWith('patch:')) {
    const metadata = rename(stored, 'metadata_revision');
    const ref = metadata.draft_ref;
    return ref && typeof ref === 'object' && !Array.isArray(ref)
      ? { ...metadata, draft_ref: rename(ref as Record<string, unknown>, 'draft_revision') }
      : metadata;
  }
  return scope.startsWith('draft:') ? rename(stored, 'draft_revision') : stored;
}

/**
 * Handles idempotency check before write operations.
 * If record exists with matching request hash, returns the cached response.
 * If record exists with mismatching request hash, throws 409 IDEMPOTENCY_KEY_COLLISION.
 */
async function checkIdempotency<T>(
  db: ProductExecutor,
  scope: string,
  key: string,
  payloadHashes: readonly string[],
): Promise<ServiceResult<T> | undefined> {
  const existing = await findIdempotencyRecord(db, scope, key);
  if (!existing) return undefined;

  if (!payloadHashes.includes(existing.request_hash)) {
    throw new ProductError(
      409,
      'IDEMPOTENCY_KEY_COLLISION',
      'Idempotency key reused with different request payload',
    );
  }

  return {
    status: existing.response_status,
    data: replayResponse(scope, existing.response_body) as T,
    replayed: true,
  };
}

/**
 * One transaction per idempotent write: lock (scope, key), replay or reject a reused key, run the
 * business write, then store the response. A crash or error anywhere rolls back both the write and
 * the record, so a retry with the same key and payload re-executes instead of duplicating.
 */
async function idempotent<T>(
  db: ProductDatabase,
  scope: string,
  key: string,
  payloadHash: string | readonly string[],
  status: number,
  work: (tx: ProductExecutor) => Promise<T>,
): Promise<ServiceResult<T>> {
  const payloadHashes = typeof payloadHash === 'string' ? [payloadHash] : payloadHash;
  return withIdempotencyLock(db, scope, key, async (tx) => {
    const replayed = await checkIdempotency<T>(tx, scope, key, payloadHashes);
    if (replayed) return replayed;
    const data = await work(tx);
    await saveIdempotencyRecord(tx, {
      scope,
      key,
      request_hash: payloadHashes[0]!,
      response_status: status,
      response_body: data as unknown as Record<string, unknown>,
    });
    return { status, data };
  });
}

export async function createExperience(
  db: ProductDatabase,
  input: CreateExperienceInput,
  user: { sub: string },
): Promise<ServiceResult<ExperienceMetadataDTO>> {
  const scope = 'create_experience';
  const payloadHash = computeContentHash({
    name: input.name,
    description: input.description,
    activity_type: input.activity_type,
  });

  return idempotent(db, scope, input.idempotency_key, payloadHash, 201, async (tx) => {
    const experienceId = `exp_${randomBytes(8).toString('hex')}`;
    const { experience, draft } = await insertExperienceWithDraft(tx, {
      id: experienceId,
      name: input.name,
      description: input.description,
      activity_type: input.activity_type,
      updated_by: user.sub,
      initialDraftContent: {},
    });

    return toExperienceMetadataDTO(experience, {
      draft_id: draft.draft_id,
      draft_revision: draft.revision,
      content_hash: draft.content_hash,
    });
  });
}

export async function getExperience(
  db: ProductDatabase,
  id: string,
): Promise<ExperienceMetadataDTO> {
  const result = await findExperienceWithDraft(db, id);
  if (!result) {
    throw new ProductError(404, 'RESOURCE_NOT_FOUND', 'Experience not found');
  }

  const draftRef = result.draft
    ? {
        draft_id: result.draft.draft_id,
        draft_revision: result.draft.revision,
        content_hash: result.draft.content_hash,
      }
    : null;

  return toExperienceMetadataDTO(result.experience, draftRef);
}

export async function listExperiences(
  db: ProductDatabase,
  query: PaginationQuery,
): Promise<{ items: ExperienceMetadataDTO[]; next_cursor: string | null }> {
  const { items, next_cursor } = await repoListExperiences(db, {
    limit: query.limit,
    cursor: query.cursor,
  });

  return {
    items: items.map((item) => toExperienceMetadataDTO(item.experience, item.draftRef ? { draft_id: item.draftRef.draft_id, draft_revision: item.draftRef.revision, content_hash: item.draftRef.content_hash } : null)),
    next_cursor,
  };
}

export async function patchExperience(
  db: ProductDatabase,
  id: string,
  input: PatchExperienceInput,
): Promise<ServiceResult<ExperienceMetadataDTO>> {
  const scope = `patch:${id}`;
  const payloadHash = revisionPayloadHashes({
    expected_revision: input.expected_metadata_revision,
    name: input.name,
    description: input.description,
  }, 'expected_metadata_revision');

  return idempotent(db, scope, input.idempotency_key, payloadHash, 200, async (tx) => {
    const result = await patchExperienceMetadata(tx, id, input.expected_metadata_revision, {
      name: input.name,
      description: input.description,
    });

    if (result.status === 'not_found') {
      throw new ProductError(404, 'RESOURCE_NOT_FOUND', 'Experience not found');
    }

    if (result.status === 'conflict') {
      throw new ProductError(409, 'REVISION_CONFLICT', 'Experience revision conflict', false, {
        kind: 'revision_conflict',
        expected_metadata_revision: input.expected_metadata_revision,
        actual_metadata_revision: result.current.revision,
      });
    }

    return toExperienceMetadataDTO(result.experience, result.draftRef ? { draft_id: result.draftRef.draft_id, draft_revision: result.draftRef.revision, content_hash: result.draftRef.content_hash } : null);
  });
}

export async function readExperienceDraft(
  db: ProductDatabase,
  experienceId: string,
): Promise<ExperienceDraftDTO> {
  const draft = await findDraftByExperienceId(db, experienceId);
  if (!draft) {
    throw new ProductError(404, 'RESOURCE_NOT_FOUND', 'Experience draft not found');
  }

  return toExperienceDraftDTO(draft);
}

export async function saveExperienceDraft(
  db: ProductDatabase,
  experienceId: string,
  input: {
    expected_draft_revision: number;
    idempotency_key: string;
    content: Record<string, unknown>;
  },
  user: { sub: string },
): Promise<ServiceResult<ExperienceDraftDTO>> {
  const scope = `draft:${experienceId}`;
  const newHash = computeContentHash(input.content);
  const payloadHash = revisionPayloadHashes({
    expected_revision: input.expected_draft_revision,
    content: input.content,
  }, 'expected_draft_revision');

  return idempotent(db, scope, input.idempotency_key, payloadHash, 200, async (tx) => {
    const result = await updateDraftContent(
      tx,
      experienceId,
      input.expected_draft_revision,
      input.content,
      newHash,
      user.sub,
    );

    if (result.status === 'not_found') {
      throw new ProductError(404, 'RESOURCE_NOT_FOUND', 'Experience or draft not found');
    }

    if (result.status === 'conflict') {
      throw new ProductError(409, 'REVISION_CONFLICT', 'Draft revision conflict', false, {
        kind: 'revision_conflict',
        expected_draft_revision: input.expected_draft_revision,
        actual_draft_revision: result.current.revision,
        current_content_hash: result.current.content_hash,
      });
    }

    return toExperienceDraftDTO(result.draft);
  });
}

export async function publishExperienceRelease(
  db: ProductDatabase,
  experienceId: string,
  input: PublishReleaseInput,
  user: { sub: string },
  reports: PublishReportVerifier = getPublishReportVerifier(),
): Promise<ServiceResult<ExperienceReleaseDTO>> {
  const scope = `publish:${experienceId}`;
  const payloadHash = revisionPayloadHashes({
    expected_revision: input.expected_draft_revision,
    content_hash: input.content_hash,
    validation_id: input.validation_id,
    evaluation_id: input.evaluation_id,
    approval_refs: input.approval_refs,
  }, 'expected_draft_revision');

  return idempotent(db, scope, input.idempotency_key, payloadHash, 201, async (tx) => {
    const draft = await findDraftByExperienceId(tx, experienceId);
    if (!draft) {
      throw new ProductError(404, 'RESOURCE_NOT_FOUND', 'Experience or draft not found');
    }

    if (draft.revision !== input.expected_draft_revision) {
      throw new ProductError(
        409,
        'REVISION_CONFLICT',
        'Draft revision does not match expected revision',
        false,
        {
          kind: 'revision_conflict',
          expected_draft_revision: input.expected_draft_revision,
          actual_draft_revision: draft.revision,
        },
      );
    }

    if (draft.content_hash !== input.content_hash) {
      throw new ProductError(
        409,
        'STALE_REPORT',
        'Provided content hash does not match current draft content hash',
        false,
        {
          expected_content_hash: input.content_hash,
          actual_content_hash: draft.content_hash,
        },
      );
    }

    const parseResult = experienceDefinitionStructuralSchema.safeParse(draft.content);
    if (!parseResult.success) {
      throw new ProductError(
        422,
        'PUBLISH_GATE_FAILED',
        'Draft content failed structural publish gate validation',
        false,
        {
          kind: 'validation',
          issues: parseResult.error.issues.map((i) => ({
            path: i.path.join('.'),
            code: i.code,
            message: i.message,
            rule_id: null,
          })),
        },
      );
    }

    const def = parseResult.data;
    const reportResult = await reports.verify(
      {
        experience_id: experienceId,
        definition_hash: draft.content_hash,
        definition_schema_version: def.schema_version,
        engine_version: def.engine_version,
        validation_id: input.validation_id,
        evaluation_id: input.evaluation_id,
      },
      tx,
    );
    const verdict = typeof reportResult === 'boolean' ? { verified: reportResult } : reportResult;
    if (!verdict.verified) {
      // Fail closed: an unverifiable report must never become an immutable release.
      throw new ProductError(
        422,
        'PUBLISH_GATE_FAILED',
        verdict.reason ?? 'Validation and evaluation reports could not be verified',
        false,
        {
          kind: 'validation',
          issues: [
            {
              path: 'validation_id',
              code: 'report_unverified',
              message:
                verdict.reason ??
                'No passing validation/evaluation report is verifiable for this draft hash, schema and engine',
              rule_id: null,
            },
          ],
        },
      );
    }

    const releaseId = `exp_rel_${randomBytes(8).toString('hex')}`;

    const insertResult = await insertExperienceRelease(tx, {
      id: releaseId,
      experience_id: experienceId,
      definition_version: def.definition_version,
      definition_hash: draft.content_hash,
      definition_schema_version: def.schema_version,
      engine_version: def.engine_version,
      is_demo: def.is_demo,
      approval_refs: input.approval_refs,
      validation_id: input.validation_id,
      evaluation_id: input.evaluation_id,
      content: draft.content,
      published_by: user.sub,
    });

    if (insertResult.status === 'duplicate_version') {
      throw new ProductError(
        409,
        'REVISION_CONFLICT',
        `Definition version "${def.definition_version}" has already been published for this experience`,
      );
    }

    return toExperienceReleaseDTO(insertResult.release);
  });
}

export async function getExperienceRelease(
  db: ProductDatabase,
  releaseId: string,
): Promise<ExperienceReleaseDTO> {
  const release = await findReleaseById(db, releaseId);
  if (!release) {
    throw new ProductError(404, 'RESOURCE_NOT_FOUND', 'Release not found');
  }

  return toExperienceReleaseDTO(release);
}

export async function listExperienceReleases(
  db: ProductDatabase,
  experienceId: string,
  query: PaginationQuery,
): Promise<{ items: ExperienceReleaseDTO[]; next_cursor: string | null }> {
  const exp = await findExperienceById(db, experienceId);
  if (!exp) {
    throw new ProductError(404, 'RESOURCE_NOT_FOUND', 'Experience not found');
  }

  const { items, next_cursor } = await repoListReleases(db, experienceId, {
    limit: query.limit,
    cursor: query.cursor,
  });

  return {
    items: items.map(toExperienceReleaseDTO),
    next_cursor,
  };
}

/** A report must describe exactly the draft snapshot that was sent; never persist one for another snapshot. */
function assertReportMatchesRequest(
  report: { experience_id: string; content_hash: string; draft_revision: number },
  experienceId: string,
  input: { content_hash: string; expected_revision: number },
): void {
  if (
    report.experience_id !== experienceId ||
    report.content_hash !== input.content_hash ||
    report.draft_revision !== input.expected_revision
  ) {
    throw new ProductError(503, 'SYS_UNAVAILABLE', 'Runtime returned a report for a different draft snapshot', false, {
      kind: 'report_mismatch',
    });
  }
}

export async function validateExperienceDraft(
  db: ProductDatabase,
  experienceId: string,
  input: SnapshotCommandInput,
  ctx: RequestContext,
): Promise<ServiceResult<ValidationReport>> {
  const scope = `validate:${experienceId}`;
  const payloadHash = computeContentHash({
    expected_revision: input.expected_revision,
    content_hash: input.content_hash,
  });

  return idempotent(db, scope, input.idempotency_key, payloadHash, 201, async (tx) => {
    const draft = await findDraftByExperienceId(tx, experienceId);
    if (!draft) {
      throw new ProductError(404, 'RESOURCE_NOT_FOUND', 'Experience or draft not found');
    }

    if (draft.revision !== input.expected_revision) {
      throw new ProductError(
        409,
        'REVISION_CONFLICT',
        'Draft revision does not match expected revision',
        false,
        {
          kind: 'revision_conflict',
          expected_draft_revision: input.expected_revision,
          actual_draft_revision: draft.revision,
        },
      );
    }

    if (draft.content_hash !== input.content_hash) {
      throw new ProductError(
        409,
        'STALE_REPORT',
        'Provided content hash does not match current draft content hash',
        false,
        {
          expected_content_hash: input.content_hash,
          actual_content_hash: draft.content_hash,
        },
      );
    }

    const report = await getExperienceRuntimeClient().validate(
      {
        experience_id: experienceId,
        definition: draft.content,
        expected_revision: input.expected_revision,
        content_hash: input.content_hash,
        idempotency_key: input.idempotency_key,
      },
      ctx,
    );

    assertReportMatchesRequest(report, experienceId, input);
    await insertExperienceReport(tx, {
      id: report.id,
      experience_id: experienceId,
      kind: 'validation',
      draft_revision: report.draft_revision,
      content_hash: report.content_hash,
      definition_schema_version: report.definition_schema_version,
      engine_version: report.engine_version,
      status: report.status,
      mandatory_passed: report.mandatory_passed,
      report: report as unknown as Record<string, unknown>,
    });

    return report;
  });
}

export async function evaluateExperienceDraft(
  db: ProductDatabase,
  experienceId: string,
  input: SnapshotCommandInput,
  ctx: RequestContext,
): Promise<ServiceResult<EvaluationReport>> {
  const scope = `evaluate:${experienceId}`;
  const payloadHash = computeContentHash({
    expected_revision: input.expected_revision,
    content_hash: input.content_hash,
  });

  return idempotent(db, scope, input.idempotency_key, payloadHash, 201, async (tx) => {
    const draft = await findDraftByExperienceId(tx, experienceId);
    if (!draft) {
      throw new ProductError(404, 'RESOURCE_NOT_FOUND', 'Experience or draft not found');
    }

    if (draft.revision !== input.expected_revision) {
      throw new ProductError(
        409,
        'REVISION_CONFLICT',
        'Draft revision does not match expected revision',
        false,
        {
          kind: 'revision_conflict',
          expected_draft_revision: input.expected_revision,
          actual_draft_revision: draft.revision,
        },
      );
    }

    if (draft.content_hash !== input.content_hash) {
      throw new ProductError(
        409,
        'STALE_REPORT',
        'Provided content hash does not match current draft content hash',
        false,
        {
          expected_content_hash: input.content_hash,
          actual_content_hash: draft.content_hash,
        },
      );
    }

    const report = await getExperienceRuntimeClient().evaluate(
      {
        experience_id: experienceId,
        definition: draft.content,
        expected_revision: input.expected_revision,
        content_hash: input.content_hash,
        idempotency_key: input.idempotency_key,
      },
      ctx,
    );

    assertReportMatchesRequest(report, experienceId, input);
    await insertExperienceReport(tx, {
      id: report.id,
      experience_id: experienceId,
      kind: 'evaluation',
      draft_revision: report.draft_revision,
      content_hash: report.content_hash,
      definition_schema_version: report.definition_schema_version,
      engine_version: report.engine_version,
      status: report.status,
      mandatory_passed: report.mandatory_passed,
      report: report as unknown as Record<string, unknown>,
    });

    return report;
  });
}
