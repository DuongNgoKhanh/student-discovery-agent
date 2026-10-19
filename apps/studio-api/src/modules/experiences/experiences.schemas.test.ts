import { describe, expect, it } from 'vitest';
import {
  createExperienceSchema,
  experienceDefinitionStructuralSchema,
  patchExperienceSchema,
  publishReleaseSchema,
  saveDraftSchema,
  toExperienceDraftDTO,
  toExperienceMetadataDTO,
  toExperienceReleaseDTO,
  toIsoZ,
} from '@/modules/experiences/experiences.schemas';

describe('experiences.schemas', () => {
  describe('createExperienceSchema', () => {
    it('accepts valid input', () => {
      const parsed = createExperienceSchema.parse({
        name: 'New Experience',
        activity_type: 'personality_assessment',
        idempotency_key: 'key-123',
      });
      expect(parsed).toEqual({
        name: 'New Experience',
        description: '',
        activity_type: 'personality_assessment',
        idempotency_key: 'key-123',
      });
    });

    it('rejects invalid activity_type', () => {
      expect(() =>
        createExperienceSchema.parse({
          name: 'Exp',
          activity_type: 'unknown_type',
          idempotency_key: 'k1',
        }),
      ).toThrow();
    });

    it('rejects invalid idempotency_key', () => {
      expect(() =>
        createExperienceSchema.parse({
          name: 'Exp',
          activity_type: 'personality_assessment',
          idempotency_key: '-bad-prefix',
        }),
      ).toThrow();
    });
  });

  describe('patchExperienceSchema', () => {
    it('accepts patch with name only', () => {
      const parsed = patchExperienceSchema.parse({
        expected_revision: 0,
        idempotency_key: 'key-1',
        name: 'Updated Name',
      });
      expect(parsed.name).toBe('Updated Name');
    });

    it('accepts patch with description only', () => {
      const parsed = patchExperienceSchema.parse({
        expected_revision: 1,
        idempotency_key: 'key-2',
        description: 'New Description',
      });
      expect(parsed.description).toBe('New Description');
    });

    it('rejects patch when neither name nor description is provided', () => {
      expect(() =>
        patchExperienceSchema.parse({
          expected_revision: 2,
          idempotency_key: 'key-3',
        }),
      ).toThrow(/At least one of name or description must be provided/);
    });
  });

  describe('saveDraftSchema', () => {
    it('accepts valid draft content including incomplete JSON object', () => {
      const parsed = saveDraftSchema.parse({
        expected_revision: 0,
        idempotency_key: 'save-key-1',
        content: { questions: [] },
      });
      expect(parsed.content).toEqual({ questions: [] });
    });
  });

  describe('publishReleaseSchema', () => {
    it('accepts valid release publish input', () => {
      const parsed = publishReleaseSchema.parse({
        expected_revision: 2,
        content_hash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        validation_id: 'val-100',
        evaluation_id: 'eval-200',
        approval_refs: ['appr-1', 'appr-2'],
        idempotency_key: 'pub-key-1',
      });
      expect(parsed.expected_revision).toBe(2);
    });

    it('rejects non-sha256 content_hash', () => {
      expect(() =>
        publishReleaseSchema.parse({
          expected_revision: 0,
          content_hash: 'md5:badhash',
          validation_id: 'val-1',
          evaluation_id: 'eval-1',
          approval_refs: [],
          idempotency_key: 'k1',
        }),
      ).toThrow();
    });
  });

  describe('experienceDefinitionStructuralSchema', () => {
    const validDef = {
      schema_version: '1.0',
      definition_id: 'def-1',
      definition_version: '1.0.0',
      engine_version: '1.0.0',
      is_demo: false,
      questions: [1, 2, 3, 4, 5, 6],
      houses: [1, 2, 3, 4, 5, 6],
      selection_rules: {},
      scoring_rules: {},
      coverage_rules: {},
      tie_policy: {},
      templates: { t1: 'template' },
      evaluation_cases: [],
      approval_refs: ['ref-1'],
    };

    it('validates a complete structural definition document', () => {
      expect(() => experienceDefinitionStructuralSchema.parse(validDef)).not.toThrow();
    });

    it('rejects definition with fewer than 6 questions', () => {
      expect(() =>
        experienceDefinitionStructuralSchema.parse({ ...validDef, questions: [1, 2, 3] }),
      ).toThrow();
    });

    it('rejects definition with wrong houses count', () => {
      expect(() =>
        experienceDefinitionStructuralSchema.parse({ ...validDef, houses: [1, 2, 3, 4, 5] }),
      ).toThrow();
    });

    it('rejects wrong schema_version', () => {
      expect(() =>
        experienceDefinitionStructuralSchema.parse({ ...validDef, schema_version: '2.0' }),
      ).toThrow();
    });
  });

  describe('DTO mappers', () => {
    it('toIsoZ formats date with trailing Z', () => {
      const zStr = toIsoZ(new Date('2026-10-19T10:00:00.000Z'));
      expect(zStr.endsWith('Z')).toBe(true);
    });

    it('toExperienceMetadataDTO maps experience and draftRef correctly', () => {
      const now = new Date();
      const meta = toExperienceMetadataDTO(
        {
          id: 'exp-1',
          revision: 0,
          name: 'Exp 1',
          description: 'Desc',
          activity_type: 'personality_assessment',
          created_at: now,
          updated_at: now,
        },
        {
          draft_id: 'draft-1',
          revision: 0,
          content_hash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
      );
      expect(meta.id).toBe('exp-1');
      expect(meta.draft_ref?.draft_id).toBe('draft-1');
      expect(meta.created_at.endsWith('Z')).toBe(true);
      expect(meta.updated_at.endsWith('Z')).toBe(true);
    });

    it('toExperienceDraftDTO maps draft entity correctly', () => {
      const now = new Date();
      const draft = toExperienceDraftDTO({
        experience_id: 'exp-1',
        draft_id: 'draft-1',
        revision: 1,
        content_hash: 'sha256:abc',
        content: { foo: 'bar' },
        updated_by: 'admin',
        updated_at: now,
      });
      expect(draft.experience_id).toBe('exp-1');
      expect(draft.content).toEqual({ foo: 'bar' });
      expect(draft.updated_at.endsWith('Z')).toBe(true);
    });

    it('toExperienceReleaseDTO maps release entity correctly', () => {
      const now = new Date();
      const rel = toExperienceReleaseDTO({
        id: 'rel-1',
        experience_id: 'exp-1',
        definition_version: '1.0.0',
        definition_hash: 'sha256:abc',
        definition_schema_version: '1.0',
        engine_version: '1.0',
        is_demo: false,
        approval_refs: ['appr-1'],
        published_at: now,
        published_by: 'admin',
      });
      expect(rel.id).toBe('rel-1');
      expect(rel.published_at.endsWith('Z')).toBe(true);
    });
  });
});

