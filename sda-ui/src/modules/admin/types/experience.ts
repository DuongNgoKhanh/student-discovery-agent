/**
 * Experience and Draft definitions aligned with docs/openapi/experience-api.yaml
 * and docs/openapi/experience-release-api.yaml.
 */

export interface DraftRef {
  draft_id: string;
  revision: number;
  content_hash: string;
}

export interface ExperienceMetadata {
  id: string;
  revision: number;
  name: string;
  description?: string | null;
  activity_type: string;
  created_at: string;
  updated_at: string;
  draft_ref?: DraftRef | null;
}

export interface ExperienceDraft {
  experience_id: string;
  draft_id: string;
  revision: number;
  content_hash: string;
  content: Record<string, unknown>;
  updated_by: string;
  updated_at: string;
}

export interface SaveDraftInput {
  expected_revision: number;
  idempotency_key: string;
  content: Record<string, unknown>;
}

export interface ExperienceRelease {
  id: string;
  experience_id: string;
  definition_version: string;
  definition_hash: string;
  definition_schema_version: string;
  engine_version: string;
  is_demo: boolean;
  configuration: Record<string, unknown>;
  approval_refs: string[];
  published_by: string;
  published_at: string;
}

export interface ActiveReleasePointer {
  experience_id: string;
  environment: string;
  revision: number;
  release_id: string | null;
  updated_at: string;
}

