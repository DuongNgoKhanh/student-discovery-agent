import { z } from 'zod';

export const resourceIdRegex = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const resourceIdSchema = z
  .string()
  .min(1)
  .regex(resourceIdRegex, 'Identifier must match ^[A-Za-z0-9][A-Za-z0-9._-]*$');

export const contentHashRegex = /^sha256:[a-f0-9]{64}$/;
export const contentHashSchema = z
  .string()
  .regex(contentHashRegex, 'Content hash must be formatted as sha256:<64-hex-digest>');

export const activityTypeSchema = z.enum(['personality_assessment']);

export const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const idempotencyKeySchema = z
  .string()
  .min(1)
  .regex(resourceIdRegex, 'Idempotency key must match ^[A-Za-z0-9][A-Za-z0-9._-]*$');

export const createExperienceSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().default(''),
  activity_type: activityTypeSchema,
  idempotency_key: idempotencyKeySchema,
});
export type CreateExperienceInput = z.infer<typeof createExperienceSchema>;

export const patchExperienceSchema = z
  .object({
    expected_revision: revisionSchema,
    idempotency_key: idempotencyKeySchema,
    name: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: 'At least one of name or description must be provided',
    path: ['name'],
  });
export type PatchExperienceInput = z.infer<typeof patchExperienceSchema>;

export const saveDraftSchema = z.object({
  expected_revision: revisionSchema,
  idempotency_key: idempotencyKeySchema,
  content: z.record(z.unknown()),
});
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;

export const publishReleaseSchema = z.object({
  expected_revision: revisionSchema,
  content_hash: contentHashSchema,
  validation_id: resourceIdSchema,
  evaluation_id: resourceIdSchema,
  approval_refs: z.array(resourceIdSchema),
  idempotency_key: idempotencyKeySchema,
});
export type PublishReleaseInput = z.infer<typeof publishReleaseSchema>;

export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * Structural schema for validating an Experience Definition Document prior to publishing.
 */
export const experienceDefinitionStructuralSchema = z.object({
  schema_version: z.literal('1.0'),
  definition_id: z.string().min(1).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  definition_version: z.string().min(1),
  engine_version: z.string().min(1),
  is_demo: z.boolean(),
  questions: z.array(z.unknown()).min(6),
  houses: z.array(z.unknown()).min(6).max(6),
  selection_rules: z.record(z.unknown()),
  scoring_rules: z.record(z.unknown()),
  coverage_rules: z.record(z.unknown()),
  tie_policy: z.record(z.unknown()),
  templates: z.record(z.string().min(1)),
  evaluation_cases: z.array(z.unknown()),
  approval_refs: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)),
});
export type ExperienceDefinitionStructural = z.infer<typeof experienceDefinitionStructuralSchema>;

export interface DraftRefDTO {
  draft_id: string;
  revision: number;
  content_hash: string;
}

export interface ExperienceMetadataDTO {
  id: string;
  revision: number;
  name: string;
  description: string;
  activity_type: 'personality_assessment';
  created_at: string;
  updated_at: string;
  draft_ref: DraftRefDTO | null;
}

export interface ExperienceDraftDTO {
  experience_id: string;
  draft_id: string;
  revision: number;
  content_hash: string;
  content: Record<string, unknown>;
  updated_by: string;
  updated_at: string;
}

export interface ExperienceReleaseDTO {
  id: string;
  experience_id: string;
  definition_version: string;
  definition_hash: string;
  definition_schema_version: string;
  engine_version: string;
  is_demo: boolean;
  approval_refs: string[];
  published_at: string;
  published_by: string;
}

export function toIsoZ(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString();
}

export function toExperienceMetadataDTO(
  exp: {
    id: string;
    revision: number;
    name: string;
    description: string;
    activity_type: string;
    created_at: Date | string;
    updated_at: Date | string;
  },
  draftRef: DraftRefDTO | null = null,
): ExperienceMetadataDTO {
  return {
    id: exp.id,
    revision: exp.revision,
    name: exp.name,
    description: exp.description,
    activity_type: exp.activity_type as 'personality_assessment',
    created_at: toIsoZ(exp.created_at),
    updated_at: toIsoZ(exp.updated_at),
    draft_ref: draftRef,
  };
}

export function toExperienceDraftDTO(
  draft: {
    experience_id: string;
    draft_id: string;
    revision: number;
    content_hash: string;
    content: Record<string, unknown>;
    updated_by: string;
    updated_at: Date | string;
  },
): ExperienceDraftDTO {
  return {
    experience_id: draft.experience_id,
    draft_id: draft.draft_id,
    revision: draft.revision,
    content_hash: draft.content_hash,
    content: draft.content,
    updated_by: draft.updated_by,
    updated_at: toIsoZ(draft.updated_at),
  };
}

export function toExperienceReleaseDTO(
  release: {
    id: string;
    experience_id: string;
    definition_version: string;
    definition_hash: string;
    definition_schema_version: string;
    engine_version: string;
    is_demo: boolean;
    approval_refs: string[];
    published_at: Date | string;
    published_by: string;
  },
): ExperienceReleaseDTO {
  return {
    id: release.id,
    experience_id: release.experience_id,
    definition_version: release.definition_version,
    definition_hash: release.definition_hash,
    definition_schema_version: release.definition_schema_version,
    engine_version: release.engine_version,
    is_demo: release.is_demo,
    approval_refs: release.approval_refs,
    published_at: toIsoZ(release.published_at),
    published_by: release.published_by,
  };
}

