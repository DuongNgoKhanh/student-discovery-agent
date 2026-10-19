import { randomBytes } from 'node:crypto';
import type { ProductDatabase } from '@/infrastructure/db/client';
import { ProductError } from '@/http/errors';
import { computeContentHash } from '@/modules/experiences/canonical';
import {
  findDraftByExperienceId,
  findExperienceById,
  findExperienceWithDraft,
  findIdempotencyRecord,
  findReleaseById,
  insertExperienceRelease,
  insertExperienceWithDraft,
  listExperienceReleases as repoListReleases,
  listExperiences as repoListExperiences,
  patchExperienceMetadata,
  saveIdempotencyRecord,
  updateDraftContent,
} from '@/modules/experiences/experiences.repository';
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
} from '@/modules/experiences/experiences.schemas';

export interface ServiceResult<T> {
  status: number;
  data: T;
  replayed?: boolean;
}

/**
 * Handles idempotency check before write operations.
 * If record exists with matching request hash, returns the cached response.
 * If record exists with mismatching request hash, throws 409 IDEMPOTENCY_KEY_COLLISION.
 */
async function checkIdempotency<T>(
  db: ProductDatabase,
  scope: string,
  key: string,
  payloadHash: string,
): Promise<ServiceResult<T> | undefined> {
  const existing = await findIdempotencyRecord(db, scope, key);
  if (!existing) return undefined;

  if (existing.request_hash !== payloadHash) {
    throw new ProductError(
      409,
      'IDEMPOTENCY_KEY_COLLISION',
      'Idempotency key reused with different request payload',
    );
  }

  return {
    status: existing.response_status,
    data: existing.response_body as T,
    replayed: true,
  };
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

  const replayed = await checkIdempotency<ExperienceMetadataDTO>(
    db,
    scope,
    input.idempotency_key,
    payloadHash,
  );
  if (replayed) return replayed;

  const experienceId = `exp_${randomBytes(8).toString('hex')}`;
  const { experience, draft } = await insertExperienceWithDraft(db, {
    id: experienceId,
    name: input.name,
    description: input.description,
    activity_type: input.activity_type,
    updated_by: user.sub,
    initialDraftContent: {},
  });

  const dto = toExperienceMetadataDTO(experience, {
    draft_id: draft.draft_id,
    revision: draft.revision,
    content_hash: draft.content_hash,
  });

  await saveIdempotencyRecord(db, {
    scope,
    key: input.idempotency_key,
    request_hash: payloadHash,
    response_status: 201,
    response_body: dto as unknown as Record<string, unknown>,
  });

  return { status: 201, data: dto };
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
        revision: result.draft.revision,
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
    items: items.map((item) => toExperienceMetadataDTO(item.experience, item.draftRef)),
    next_cursor,
  };
}

export async function patchExperience(
  db: ProductDatabase,
  id: string,
  input: PatchExperienceInput,
): Promise<ServiceResult<ExperienceMetadataDTO>> {
  const scope = `patch:${id}`;
  const payloadHash = computeContentHash({
    expected_revision: input.expected_revision,
    name: input.name,
    description: input.description,
  });

  const replayed = await checkIdempotency<ExperienceMetadataDTO>(
    db,
    scope,
    input.idempotency_key,
    payloadHash,
  );
  if (replayed) return replayed;

  const result = await patchExperienceMetadata(db, id, input.expected_revision, {
    name: input.name,
    description: input.description,
  });

  if (result.status === 'not_found') {
    throw new ProductError(404, 'RESOURCE_NOT_FOUND', 'Experience not found');
  }

  if (result.status === 'conflict') {
    throw new ProductError(409, 'REVISION_CONFLICT', 'Experience revision conflict', false, {
      kind: 'revision_conflict',
      expected_revision: input.expected_revision,
      actual_revision: result.current.revision,
    });
  }

  const dto = toExperienceMetadataDTO(result.experience, result.draftRef);

  await saveIdempotencyRecord(db, {
    scope,
    key: input.idempotency_key,
    request_hash: payloadHash,
    response_status: 200,
    response_body: dto as unknown as Record<string, unknown>,
  });

  return { status: 200, data: dto };
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
    expected_revision: number;
    idempotency_key: string;
    content: Record<string, unknown>;
  },
  user: { sub: string },
): Promise<ServiceResult<ExperienceDraftDTO>> {
  const scope = `draft:${experienceId}`;
  const newHash = computeContentHash(input.content);
  const payloadHash = computeContentHash({
    expected_revision: input.expected_revision,
    content: input.content,
  });

  const replayed = await checkIdempotency<ExperienceDraftDTO>(
    db,
    scope,
    input.idempotency_key,
    payloadHash,
  );
  if (replayed) return replayed;

  const result = await updateDraftContent(
    db,
    experienceId,
    input.expected_revision,
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
      expected_revision: input.expected_revision,
      actual_revision: result.current.revision,
      current_content_hash: result.current.content_hash,
    });
  }

  const dto = toExperienceDraftDTO(result.draft);

  await saveIdempotencyRecord(db, {
    scope,
    key: input.idempotency_key,
    request_hash: payloadHash,
    response_status: 200,
    response_body: dto as unknown as Record<string, unknown>,
  });

  return { status: 200, data: dto };
}

export async function publishExperienceRelease(
  db: ProductDatabase,
  experienceId: string,
  input: PublishReleaseInput,
  user: { sub: string },
): Promise<ServiceResult<ExperienceReleaseDTO>> {
  const scope = `publish:${experienceId}`;
  const payloadHash = computeContentHash({
    expected_revision: input.expected_revision,
    content_hash: input.content_hash,
    validation_id: input.validation_id,
    evaluation_id: input.evaluation_id,
    approval_refs: input.approval_refs,
  });

  const replayed = await checkIdempotency<ExperienceReleaseDTO>(
    db,
    scope,
    input.idempotency_key,
    payloadHash,
  );
  if (replayed) return replayed;

  const draft = await findDraftByExperienceId(db, experienceId);
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
        expected_revision: input.expected_revision,
        actual_revision: draft.revision,
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
  const releaseId = `exp_rel_${randomBytes(8).toString('hex')}`;

  const insertResult = await insertExperienceRelease(db, {
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

  const dto = toExperienceReleaseDTO(insertResult.release);

  await saveIdempotencyRecord(db, {
    scope,
    key: input.idempotency_key,
    request_hash: payloadHash,
    response_status: 201,
    response_body: dto as unknown as Record<string, unknown>,
  });

  return { status: 201, data: dto };
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

