import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductError } from '@/http/errors';
import type { ProductDatabase } from '@/infrastructure/db/client';
import { computeContentHash } from '@/modules/experiences/canonical';
import * as repo from '@/modules/experiences/experiences.repository';
import { RuntimeReportVerifier, setPublishReportVerifier } from '@/modules/experiences/experiences.reports';
import { setExperienceRuntimeClient } from '@/modules/experiences/runtime-client';
import {
  createExperience,
  evaluateExperienceDraft,
  getExperience,
  getExperienceRelease,
  listExperienceReleases,
  listExperiences,
  patchExperience,
  publishExperienceRelease,
  readExperienceDraft,
  saveExperienceDraft,
  validateExperienceDraft,
} from '@/modules/experiences/experiences.service';

vi.mock('@/modules/experiences/experiences.repository');

const mockDb = {} as ProductDatabase;
const mockAdmin = { sub: 'admin-user' };

describe('experiences.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The real lock opens a transaction; unit tests run the work directly against the mock DB.
    vi.mocked(repo.withIdempotencyLock).mockImplementation((db, _scope, _key, work) => work(db));
  });

  describe('createExperience', () => {
    it('creates experience and returns 201 with metadata and draft_ref', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.insertExperienceWithDraft).mockResolvedValue({
        experience: {
          id: 'exp_1',
          name: 'Exp 1',
          description: '',
          activity_type: 'personality_assessment',
          revision: 0,
          created_at: new Date('2026-10-19T10:00:00Z'),
          updated_at: new Date('2026-10-19T10:00:00Z'),
        },
        draft: {
          draft_id: 'draft_exp_1',
          experience_id: 'exp_1',
          revision: 0,
          content_hash: 'sha256:empty',
          content: {},
          updated_by: 'admin-user',
          updated_at: new Date('2026-10-19T10:00:00Z'),
        },
      });

      const res = await createExperience(
        mockDb,
        {
          name: 'Exp 1',
          description: '',
          activity_type: 'personality_assessment',
          idempotency_key: 'key-1',
        },
        mockAdmin,
      );

      expect(res.status).toBe(201);
      expect(res.data.id).toBe('exp_1');
      expect(res.data.draft_ref?.draft_id).toBe('draft_exp_1');
      expect(repo.saveIdempotencyRecord).toHaveBeenCalledTimes(1);
    });

    it('replays identical request if idempotency key exists with same hash', async () => {
      const payloadHash = computeContentHash({
        name: 'Exp 1',
        description: '',
        activity_type: 'personality_assessment',
      });
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue({
        scope: 'create_experience',
        key: 'key-1',
        request_hash: payloadHash,
        response_status: 201,
        response_body: { id: 'exp_cached', name: 'Cached' },
        created_at: new Date(),
      });

      const res = await createExperience(
        mockDb,
        {
          name: 'Exp 1',
          description: '',
          activity_type: 'personality_assessment',
          idempotency_key: 'key-1',
        },
        mockAdmin,
      );

      expect(res.status).toBe(201);
      expect(res.replayed).toBe(true);
      expect(res.data).toEqual({ id: 'exp_cached', name: 'Cached' });
      expect(repo.insertExperienceWithDraft).not.toHaveBeenCalled();
    });

    it('throws 409 IDEMPOTENCY_KEY_COLLISION if idempotency key reused with different payload', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue({
        scope: 'create_experience',
        key: 'key-1',
        request_hash: 'sha256:different_hash',
        response_status: 201,
        response_body: {},
        created_at: new Date(),
      });

      await expect(
        createExperience(
          mockDb,
          {
            name: 'Exp 1',
            description: '',
            activity_type: 'personality_assessment',
            idempotency_key: 'key-1',
          },
          mockAdmin,
        ),
      ).rejects.toMatchObject({
        status: 409,
        code: 'IDEMPOTENCY_KEY_COLLISION',
      });
    });
  });

  describe('getExperience', () => {
    it('returns experience metadata with draft_ref', async () => {
      vi.mocked(repo.findExperienceWithDraft).mockResolvedValue({
        experience: {
          id: 'exp_1',
          name: 'Exp 1',
          description: 'Desc',
          activity_type: 'personality_assessment',
          revision: 1,
          created_at: new Date('2026-10-19T10:00:00Z'),
          updated_at: new Date('2026-10-19T10:00:00Z'),
        },
        draft: {
          draft_id: 'draft_1',
          experience_id: 'exp_1',
          revision: 2,
          content_hash: 'sha256:draft_hash',
          content: {},
          updated_by: 'admin',
          updated_at: new Date('2026-10-19T10:00:00Z'),
        },
      });

      const res = await getExperience(mockDb, 'exp_1');
      expect(res.id).toBe('exp_1');
      expect(res.draft_ref?.draft_revision).toBe(2);
    });

    it('throws 404 RESOURCE_NOT_FOUND when experience does not exist', async () => {
      vi.mocked(repo.findExperienceWithDraft).mockResolvedValue(undefined);

      await expect(getExperience(mockDb, 'exp_nonexistent')).rejects.toMatchObject({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
      });
    });
  });

  describe('listExperiences', () => {
    it('delegates to repo and maps items', async () => {
      vi.mocked(repo.listExperiences).mockResolvedValue({
        items: [
          {
            experience: {
              id: 'exp_1',
              name: 'Exp 1',
              description: '',
              activity_type: 'personality_assessment',
              revision: 0,
              created_at: new Date('2026-10-19T10:00:00Z'),
              updated_at: new Date('2026-10-19T10:00:00Z'),
            },
            draftRef: {
              draft_id: 'draft_1',
              revision: 0,
              content_hash: 'sha256:abc',
            },
          },
        ],
        next_cursor: 'cursor_1',
      });

      const res = await listExperiences(mockDb, { limit: 20 });
      expect(res.items).toHaveLength(1);
      expect(res.next_cursor).toBe('cursor_1');
    });
  });

  describe('patchExperience', () => {
    it('patches metadata and increments revision', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.patchExperienceMetadata).mockResolvedValue({
        status: 'ok',
        experience: {
          id: 'exp_1',
          name: 'New Name',
          description: '',
          activity_type: 'personality_assessment',
          revision: 1,
          created_at: new Date('2026-10-19T10:00:00Z'),
          updated_at: new Date('2026-10-19T11:00:00Z'),
        },
        draftRef: null,
      });

      const res = await patchExperience(mockDb, 'exp_1', {
        expected_metadata_revision: 0,
        idempotency_key: 'patch_key_1',
        name: 'New Name',
      });

      expect(res.status).toBe(200);
      expect(res.data.metadata_revision).toBe(1);
      expect(repo.saveIdempotencyRecord).toHaveBeenCalledTimes(1);
    });

    it('throws 409 REVISION_CONFLICT on stale revision with current state in details', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.patchExperienceMetadata).mockResolvedValue({
        status: 'conflict',
        current: {
          id: 'exp_1',
          name: 'Existing Name',
          description: '',
          activity_type: 'personality_assessment',
          revision: 2,
          created_at: new Date('2026-10-19T10:00:00Z'),
          updated_at: new Date('2026-10-19T11:00:00Z'),
        },
      });

      await expect(
        patchExperience(mockDb, 'exp_1', {
          expected_metadata_revision: 1,
          idempotency_key: 'patch_key_2',
          name: 'Stale Patch',
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'REVISION_CONFLICT',
        details: {
          expected_metadata_revision: 1,
          actual_metadata_revision: 2,
        },
      });
    });

    it('throws 404 RESOURCE_NOT_FOUND when experience does not exist', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.patchExperienceMetadata).mockResolvedValue({ status: 'not_found' });

      await expect(
        patchExperience(mockDb, 'exp_missing', {
          expected_metadata_revision: 0,
          idempotency_key: 'patch_key_3',
          name: 'Missing',
        }),
      ).rejects.toMatchObject({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
      });
    });
  });

  describe('readExperienceDraft', () => {
    it('returns draft content and metadata', async () => {
      vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
        draft_id: 'draft_1',
        experience_id: 'exp_1',
        revision: 1,
        content_hash: 'sha256:abc',
        content: { questions: [] },
        updated_by: 'admin',
        updated_at: new Date('2026-10-19T10:00:00Z'),
      });

      const res = await readExperienceDraft(mockDb, 'exp_1');
      expect(res.experience_id).toBe('exp_1');
      expect(res.draft_revision).toBe(1);
    });

    it('throws 404 when draft not found', async () => {
      vi.mocked(repo.findDraftByExperienceId).mockResolvedValue(undefined);

      await expect(readExperienceDraft(mockDb, 'exp_missing')).rejects.toMatchObject({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
      });
    });
  });

  describe('saveExperienceDraft', () => {
    it('saves draft atomically and updates hash and revision', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.updateDraftContent).mockResolvedValue({
        status: 'ok',
        draft: {
          draft_id: 'draft_1',
          experience_id: 'exp_1',
          revision: 2,
          content_hash: 'sha256:new_hash',
          content: { questions: ['q1'] },
          updated_by: 'admin-user',
          updated_at: new Date('2026-10-19T12:00:00Z'),
        },
      });

      const res = await saveExperienceDraft(
        mockDb,
        'exp_1',
        {
          expected_draft_revision: 1,
          idempotency_key: 'save_key_1',
          content: { questions: ['q1'] },
        },
        mockAdmin,
      );

      expect(res.status).toBe(200);
      expect(res.data.draft_revision).toBe(2);
      expect(repo.saveIdempotencyRecord).toHaveBeenCalledTimes(1);
    });

    it('throws 409 REVISION_CONFLICT on stale revision with current revision and hash', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.updateDraftContent).mockResolvedValue({
        status: 'conflict',
        current: {
          draft_id: 'draft_1',
          experience_id: 'exp_1',
          revision: 3,
          content_hash: 'sha256:current_hash',
          content: {},
          updated_by: 'other_user',
          updated_at: new Date(),
        },
      });

      await expect(
        saveExperienceDraft(
          mockDb,
          'exp_1',
          {
            expected_draft_revision: 1,
            idempotency_key: 'save_key_2',
            content: {},
          },
          mockAdmin,
        ),
      ).rejects.toMatchObject({
        status: 409,
        code: 'REVISION_CONFLICT',
        details: {
          expected_draft_revision: 1,
          actual_draft_revision: 3,
          current_content_hash: 'sha256:current_hash',
        },
      });
    });
  });

  describe('publishExperienceRelease', () => {
    const validDefinitionContent = {
      schema_version: '1.0',
      definition_id: 'personality_def_01',
      definition_version: '1.0.0',
      engine_version: '1.0.0',
      is_demo: false,
      questions: [1, 2, 3, 4, 5, 6],
      houses: [1, 2, 3, 4, 5, 6],
      selection_rules: {},
      scoring_rules: {},
      coverage_rules: {},
      tie_policy: {},
      templates: { intro: 'Welcome' },
      evaluation_cases: [],
      approval_refs: ['appr_1'],
    };

    beforeEach(() => {
      setPublishReportVerifier({ verify: async () => true });
    });

    afterEach(() => {
      setPublishReportVerifier(null);
    });

    it('fails closed with 422 PUBLISH_GATE_FAILED when reports cannot be verified', async () => {
      setPublishReportVerifier(null);
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
        draft_id: 'draft_1',
        experience_id: 'exp_1',
        revision: 2,
        content_hash: 'sha256:expected_hash',
        content: validDefinitionContent,
        updated_by: 'admin',
        updated_at: new Date(),
      });

      await expect(
        publishExperienceRelease(
          mockDb,
          'exp_1',
          {
            expected_draft_revision: 2,
            content_hash: 'sha256:expected_hash',
            validation_id: 'val_unknown',
            evaluation_id: 'eval_unknown',
            approval_refs: [],
            idempotency_key: 'pub_key_closed',
          },
          mockAdmin,
        ),
      ).rejects.toMatchObject({
        status: 422,
        code: 'PUBLISH_GATE_FAILED',
        details: { kind: 'validation', issues: [expect.objectContaining({ code: 'report_unverified' })] },
      });
      expect(repo.insertExperienceRelease).not.toHaveBeenCalled();
      expect(repo.saveIdempotencyRecord).not.toHaveBeenCalled();
    });

    it('publishes valid draft and returns 201 release DTO', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
        draft_id: 'draft_1',
        experience_id: 'exp_1',
        revision: 2,
        content_hash: 'sha256:expected_hash',
        content: validDefinitionContent,
        updated_by: 'admin',
        updated_at: new Date(),
      });
      vi.mocked(repo.insertExperienceRelease).mockResolvedValue({
        status: 'ok',
        release: {
          id: 'exp_rel_1',
          experience_id: 'exp_1',
          definition_version: '1.0.0',
          definition_hash: 'sha256:expected_hash',
          definition_schema_version: '1.0',
          engine_version: '1.0.0',
          is_demo: false,
          approval_refs: ['appr_1'],
          validation_id: 'val_1',
          evaluation_id: 'eval_1',
          content: validDefinitionContent,
          published_at: new Date('2026-10-19T12:00:00Z'),
          published_by: 'admin-user',
        },
      });

      const res = await publishExperienceRelease(
        mockDb,
        'exp_1',
        {
          expected_draft_revision: 2,
          content_hash: 'sha256:expected_hash',
          validation_id: 'val_1',
          evaluation_id: 'eval_1',
          approval_refs: ['appr_1'],
          idempotency_key: 'pub_key_1',
        },
        mockAdmin,
      );

      expect(res.status).toBe(201);
      expect(res.data.id).toBe('exp_rel_1');
      expect(res.data.definition_version).toBe('1.0.0');
      expect(repo.saveIdempotencyRecord).toHaveBeenCalledTimes(1);
    });

    it('rejects with 409 REVISION_CONFLICT if draft revision differs from expected_draft_revision', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
        draft_id: 'draft_1',
        experience_id: 'exp_1',
        revision: 3,
        content_hash: 'sha256:expected_hash',
        content: validDefinitionContent,
        updated_by: 'admin',
        updated_at: new Date(),
      });

      await expect(
        publishExperienceRelease(
          mockDb,
          'exp_1',
          {
            expected_draft_revision: 2,
            content_hash: 'sha256:expected_hash',
            validation_id: 'val_1',
            evaluation_id: 'eval_1',
            approval_refs: [],
            idempotency_key: 'pub_key_2',
          },
          mockAdmin,
        ),
      ).rejects.toMatchObject({
        status: 409,
        code: 'REVISION_CONFLICT',
      });
    });

    it('rejects with 409 STALE_REPORT if draft hash differs from input content_hash', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
        draft_id: 'draft_1',
        experience_id: 'exp_1',
        revision: 2,
        content_hash: 'sha256:actual_hash',
        content: validDefinitionContent,
        updated_by: 'admin',
        updated_at: new Date(),
      });

      await expect(
        publishExperienceRelease(
          mockDb,
          'exp_1',
          {
            expected_draft_revision: 2,
            content_hash: 'sha256:stale_hash',
            validation_id: 'val_1',
            evaluation_id: 'eval_1',
            approval_refs: [],
            idempotency_key: 'pub_key_3',
          },
          mockAdmin,
        ),
      ).rejects.toMatchObject({
        status: 409,
        code: 'STALE_REPORT',
      });
    });

    it('rejects with 422 PUBLISH_GATE_FAILED if draft fails structural definition schema', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
        draft_id: 'draft_1',
        experience_id: 'exp_1',
        revision: 2,
        content_hash: 'sha256:incomplete_hash',
        content: { questions: [] }, // Incomplete!
        updated_by: 'admin',
        updated_at: new Date(),
      });

      await expect(
        publishExperienceRelease(
          mockDb,
          'exp_1',
          {
            expected_draft_revision: 2,
            content_hash: 'sha256:incomplete_hash',
            validation_id: 'val_1',
            evaluation_id: 'eval_1',
            approval_refs: [],
            idempotency_key: 'pub_key_4',
          },
          mockAdmin,
        ),
      ).rejects.toMatchObject({
        status: 422,
        code: 'PUBLISH_GATE_FAILED',
      });
    });

    it('rejects with 409 REVISION_CONFLICT if definition version already published', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
        draft_id: 'draft_1',
        experience_id: 'exp_1',
        revision: 2,
        content_hash: 'sha256:expected_hash',
        content: validDefinitionContent,
        updated_by: 'admin',
        updated_at: new Date(),
      });
      vi.mocked(repo.insertExperienceRelease).mockResolvedValue({
        status: 'duplicate_version',
      });

      await expect(
        publishExperienceRelease(
          mockDb,
          'exp_1',
          {
            expected_draft_revision: 2,
            content_hash: 'sha256:expected_hash',
            validation_id: 'val_1',
            evaluation_id: 'eval_1',
            approval_refs: [],
            idempotency_key: 'pub_key_5',
          },
          mockAdmin,
        ),
      ).rejects.toMatchObject({
        status: 409,
        code: 'REVISION_CONFLICT',
      });
    });
  });

  describe('getExperienceRelease', () => {
    it('returns release DTO when found', async () => {
      vi.mocked(repo.findReleaseById).mockResolvedValue({
        id: 'rel_1',
        experience_id: 'exp_1',
        definition_version: '1.0.0',
        definition_hash: 'sha256:abc',
        definition_schema_version: '1.0',
        engine_version: '1.0.0',
        is_demo: false,
        approval_refs: [],
        validation_id: 'val_1',
        evaluation_id: 'eval_1',
        content: {},
        published_at: new Date('2026-10-19T12:00:00Z'),
        published_by: 'admin',
      });

      const res = await getExperienceRelease(mockDb, 'rel_1');
      expect(res.id).toBe('rel_1');
    });

    it('throws 404 when release not found', async () => {
      vi.mocked(repo.findReleaseById).mockResolvedValue(undefined);

      await expect(getExperienceRelease(mockDb, 'rel_missing')).rejects.toMatchObject({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
      });
    });
  });

  describe('listExperienceReleases', () => {
    it('throws 404 if experience does not exist', async () => {
      vi.mocked(repo.findExperienceById).mockResolvedValue(undefined);

      await expect(
        listExperienceReleases(mockDb, 'exp_missing', { limit: 20 }),
      ).rejects.toMatchObject({
        status: 404,
        code: 'RESOURCE_NOT_FOUND',
      });
    });

    it('returns release items when experience exists', async () => {
      vi.mocked(repo.findExperienceById).mockResolvedValue({
        id: 'exp_1',
        name: 'Exp 1',
        description: '',
        activity_type: 'personality_assessment',
        revision: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });
      vi.mocked(repo.listExperienceReleases).mockResolvedValue({
        items: [
          {
            id: 'rel_1',
            experience_id: 'exp_1',
            definition_version: '1.0.0',
            definition_hash: 'sha256:abc',
            definition_schema_version: '1.0',
            engine_version: '1.0.0',
            is_demo: false,
            approval_refs: [],
            validation_id: 'val_1',
            evaluation_id: 'eval_1',
            content: {},
            published_at: new Date('2026-10-19T12:00:00Z'),
            published_by: 'admin',
          },
        ],
        next_cursor: null,
      });

      const res = await listExperienceReleases(mockDb, 'exp_1', { limit: 20 });
      expect(res.items).toHaveLength(1);
    });
  });

  describe('validateExperienceDraft', () => {
    const mockCtx = { requestId: 'req_v1', traceId: 'trace_v1' };
    const mockReport = {
      id: 'val_100',
      experience_id: 'exp_1',
      draft_revision: 2,
      content_hash: 'sha256:def_hash',
      definition_schema_version: '1.0',
      engine_version: '1.0.0',
      status: 'passed' as const,
      mandatory_passed: true,
      issues: [],
      created_at: '2026-11-03T10:00:00Z',
    };

    beforeEach(() => {
      setExperienceRuntimeClient({
        validate: vi.fn().mockResolvedValue(mockReport),
        evaluate: vi.fn(),
        verify: vi.fn(),
      });
    });

    afterEach(() => {
      setExperienceRuntimeClient(null);
    });

    it('returns 404 when experience draft is not found', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.findDraftByExperienceId).mockResolvedValue(undefined);

      await expect(
        validateExperienceDraft(
          mockDb,
          'exp_missing',
          { expected_revision: 1, content_hash: 'sha256:def_hash', idempotency_key: 'key_v1' },
          mockCtx,
        ),
      ).rejects.toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND' });
    });

    it('returns 409 REVISION_CONFLICT when draft revision does not match', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
        draft_id: 'draft_1',
        experience_id: 'exp_1',
        revision: 5,
        content_hash: 'sha256:def_hash',
        content: {},
        updated_by: 'admin',
        updated_at: new Date(),
      });

      await expect(
        validateExperienceDraft(
          mockDb,
          'exp_1',
          { expected_revision: 2, content_hash: 'sha256:def_hash', idempotency_key: 'key_v1' },
          mockCtx,
        ),
      ).rejects.toMatchObject({ status: 409, code: 'REVISION_CONFLICT' });
    });

    it('returns 409 STALE_REPORT when content hash does not match current draft', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
        draft_id: 'draft_1',
        experience_id: 'exp_1',
        revision: 2,
        content_hash: 'sha256:different_hash',
        content: {},
        updated_by: 'admin',
        updated_at: new Date(),
      });

      await expect(
        validateExperienceDraft(
          mockDb,
          'exp_1',
          { expected_revision: 2, content_hash: 'sha256:def_hash', idempotency_key: 'key_v1' },
          mockCtx,
        ),
      ).rejects.toMatchObject({ status: 409, code: 'STALE_REPORT' });
    });

    it('validates snapshot, stores report, and returns 201 report', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
        draft_id: 'draft_1',
        experience_id: 'exp_1',
        revision: 2,
        content_hash: 'sha256:def_hash',
        content: { def: true },
        updated_by: 'admin',
        updated_at: new Date(),
      });
      vi.mocked(repo.insertExperienceReport).mockResolvedValue({
        id: 'val_100',
        experience_id: 'exp_1',
        kind: 'validation',
        draft_revision: 2,
        content_hash: 'sha256:def_hash',
        definition_schema_version: '1.0',
        engine_version: '1.0.0',
        status: 'passed',
        mandatory_passed: true,
        report: mockReport,
        created_at: new Date(),
      });

      const res = await validateExperienceDraft(
        mockDb,
        'exp_1',
        { expected_revision: 2, content_hash: 'sha256:def_hash', idempotency_key: 'key_v1' },
        mockCtx,
      );

      expect(res.status).toBe(201);
      expect(res.data).toEqual(mockReport);
      expect(repo.insertExperienceReport).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          id: 'val_100',
          experience_id: 'exp_1',
          kind: 'validation',
          content_hash: 'sha256:def_hash',
        }),
      );
      expect(repo.saveIdempotencyRecord).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          scope: 'validate:exp_1',
          key: 'key_v1',
          response_status: 201,
        }),
      );
    });

    it('replays identical validation request when idempotency key matches', async () => {
      const payloadHash = computeContentHash({
        expected_revision: 2,
        content_hash: 'sha256:def_hash',
      });
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue({
        scope: 'validate:exp_1',
        key: 'key_v1',
        request_hash: payloadHash,
        response_status: 201,
        response_body: mockReport,
        created_at: new Date(),
      });

      const res = await validateExperienceDraft(
        mockDb,
        'exp_1',
        { expected_revision: 2, content_hash: 'sha256:def_hash', idempotency_key: 'key_v1' },
        mockCtx,
      );

      expect(res.replayed).toBe(true);
      expect(res.status).toBe(201);
      expect(res.data).toEqual(mockReport);
      expect(repo.insertExperienceReport).not.toHaveBeenCalled();
    });
  });

  describe('evaluateExperienceDraft', () => {
    const mockCtx = { requestId: 'req_e1', traceId: 'trace_e1' };
    const mockEvalReport = {
      id: 'eval_200',
      experience_id: 'exp_1',
      draft_revision: 2,
      content_hash: 'sha256:def_hash',
      definition_schema_version: '1.0',
      engine_version: '1.0.0',
      status: 'passed' as const,
      mandatory_passed: true,
      cases: [
        {
          case_id: 'case_1',
          mandatory: true,
          passed: true,
          expected: {},
          actual: {},
          issues: [],
        },
      ],
      created_at: '2026-11-03T10:00:00Z',
    };

    beforeEach(() => {
      setExperienceRuntimeClient({
        validate: vi.fn(),
        evaluate: vi.fn().mockResolvedValue(mockEvalReport),
        verify: vi.fn(),
      });
    });

    afterEach(() => {
      setExperienceRuntimeClient(null);
    });

    it('evaluates snapshot, stores report, and returns 201 report', async () => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
        draft_id: 'draft_1',
        experience_id: 'exp_1',
        revision: 2,
        content_hash: 'sha256:def_hash',
        content: { def: true },
        updated_by: 'admin',
        updated_at: new Date(),
      });
      vi.mocked(repo.insertExperienceReport).mockResolvedValue({
        id: 'eval_200',
        experience_id: 'exp_1',
        kind: 'evaluation',
        draft_revision: 2,
        content_hash: 'sha256:def_hash',
        definition_schema_version: '1.0',
        engine_version: '1.0.0',
        status: 'passed',
        mandatory_passed: true,
        report: mockEvalReport,
        created_at: new Date(),
      });

      const res = await evaluateExperienceDraft(
        mockDb,
        'exp_1',
        { expected_revision: 2, content_hash: 'sha256:def_hash', idempotency_key: 'key_e1' },
        mockCtx,
      );

      expect(res.status).toBe(201);
      expect(res.data).toEqual(mockEvalReport);
      expect(repo.insertExperienceReport).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          id: 'eval_200',
          kind: 'evaluation',
        }),
      );
    });
  });

  describe('RuntimeReportVerifier', () => {
    const input = {
      experience_id: 'exp_1',
      definition_hash: 'sha256:def_hash',
      definition_schema_version: '1.0',
      engine_version: '1.0.0',
      validation_id: 'val_100',
      evaluation_id: 'eval_200',
    };

    it('returns verified: true when local reports pass and remote verify passes', async () => {
      vi.mocked(repo.findReportById).mockImplementation(async (_db, id) => {
        if (id === 'val_100') {
          return {
            id: 'val_100',
            experience_id: 'exp_1',
            kind: 'validation',
            draft_revision: 1,
            content_hash: 'sha256:def_hash',
            definition_schema_version: '1.0',
            engine_version: '1.0.0',
            status: 'passed',
            mandatory_passed: true,
            report: {},
            created_at: new Date(),
          };
        }
        if (id === 'eval_200') {
          return {
            id: 'eval_200',
            experience_id: 'exp_1',
            kind: 'evaluation',
            draft_revision: 1,
            content_hash: 'sha256:def_hash',
            definition_schema_version: '1.0',
            engine_version: '1.0.0',
            status: 'passed',
            mandatory_passed: true,
            report: {},
            created_at: new Date(),
          };
        }
        return undefined;
      });

      const mockClient = {
        validate: vi.fn(),
        evaluate: vi.fn(),
        verify: vi.fn().mockResolvedValue({ verified: true, reason: null }),
      };

      const verifier = new RuntimeReportVerifier(() => mockDb, () => mockClient);
      const res = await verifier.verify(input);
      expect(res).toEqual({ verified: true, reason: null });
      expect(mockClient.verify).toHaveBeenCalledWith(input, expect.anything());
    });

    it('denies verification when validation report does not pass', async () => {
      vi.mocked(repo.findReportById).mockImplementation(async (_db, id) => {
        if (id === 'val_100') {
          return {
            id: 'val_100',
            experience_id: 'exp_1',
            kind: 'validation',
            draft_revision: 1,
            content_hash: 'sha256:def_hash',
            definition_schema_version: '1.0',
            engine_version: '1.0.0',
            status: 'failed',
            mandatory_passed: false,
            report: {},
            created_at: new Date(),
          };
        }
        return undefined;
      });

      const verifier = new RuntimeReportVerifier(() => mockDb);
      const res = await verifier.verify(input);
      expect(res.verified).toBe(false);
      expect(res.reason).toContain('did not pass');
    });

    it('denies verification when evaluation mandatory cases fail', async () => {
      vi.mocked(repo.findReportById).mockImplementation(async (_db, id) => {
        if (id === 'val_100') {
          return {
            id: 'val_100',
            experience_id: 'exp_1',
            kind: 'validation',
            draft_revision: 1,
            content_hash: 'sha256:def_hash',
            definition_schema_version: '1.0',
            engine_version: '1.0.0',
            status: 'passed',
            mandatory_passed: true,
            report: {},
            created_at: new Date(),
          };
        }
        if (id === 'eval_200') {
          return {
            id: 'eval_200',
            experience_id: 'exp_1',
            kind: 'evaluation',
            draft_revision: 1,
            content_hash: 'sha256:def_hash',
            definition_schema_version: '1.0',
            engine_version: '1.0.0',
            status: 'failed',
            mandatory_passed: false,
            report: {},
            created_at: new Date(),
          };
        }
        return undefined;
      });

      const verifier = new RuntimeReportVerifier(() => mockDb);
      const res = await verifier.verify(input);
      expect(res.verified).toBe(false);
      expect(res.reason).toContain('did not pass mandatory cases');
    });

    it('fails closed when remote runtime verify rejects reports', async () => {
      vi.mocked(repo.findReportById).mockImplementation(async (_db, id) => {
        if (id === 'val_100') {
          return {
            id: 'val_100',
            experience_id: 'exp_1',
            kind: 'validation',
            draft_revision: 1,
            content_hash: 'sha256:def_hash',
            definition_schema_version: '1.0',
            engine_version: '1.0.0',
            status: 'passed',
            mandatory_passed: true,
            report: {},
            created_at: new Date(),
          };
        }
        if (id === 'eval_200') {
          return {
            id: 'eval_200',
            experience_id: 'exp_1',
            kind: 'evaluation',
            draft_revision: 1,
            content_hash: 'sha256:def_hash',
            definition_schema_version: '1.0',
            engine_version: '1.0.0',
            status: 'passed',
            mandatory_passed: true,
            report: {},
            created_at: new Date(),
          };
        }
        return undefined;
      });

      const mockClient = {
        validate: vi.fn(),
        evaluate: vi.fn(),
        verify: vi.fn().mockResolvedValue({ verified: false, reason: 'Report expired in memory' }),
      };

      const verifier = new RuntimeReportVerifier(() => mockDb, () => mockClient);
      const res = await verifier.verify(input);
      expect(res.verified).toBe(false);
      expect(res.reason).toBe('Report expired in memory');
    });
  });

  describe('RuntimeReportVerifier gate checks', () => {
    const input = {
      experience_id: 'exp_1',
      definition_hash: 'sha256:def_hash',
      definition_schema_version: '1.0',
      engine_version: '1.0.0',
      validation_id: 'val_100',
      evaluation_id: 'eval_200',
    };

    const reportRow = (kind: 'validation' | 'evaluation', overrides: Record<string, unknown> = {}) => ({
      id: kind === 'validation' ? 'val_100' : 'eval_200',
      experience_id: 'exp_1',
      kind,
      draft_revision: 1,
      content_hash: 'sha256:def_hash',
      definition_schema_version: '1.0',
      engine_version: '1.0.0',
      status: 'passed',
      mandatory_passed: true,
      report: {},
      created_at: new Date(),
      ...overrides,
    });

    const arrange = (
      overrides: { validation?: Record<string, unknown>; evaluation?: Record<string, unknown> } = {},
      verify = vi.fn().mockResolvedValue({ verified: true, reason: null }),
    ) => {
      vi.mocked(repo.findReportById).mockImplementation(async (_db, id) => {
        if (id === 'val_100') return reportRow('validation', overrides.validation) as never;
        if (id === 'eval_200') return reportRow('evaluation', overrides.evaluation) as never;
        return undefined;
      });
      const client = { validate: vi.fn(), evaluate: vi.fn(), verify };
      return { client, verifier: new RuntimeReportVerifier(() => mockDb, () => client) };
    };

    it.each(['validation', 'evaluation'] as const)('rejects a %s report computed for another snapshot', async (kind) => {
      for (const override of [
        { experience_id: 'exp_other' },
        { content_hash: 'sha256:other' },
        { definition_schema_version: '9.9' },
        { engine_version: '9.9.9' },
      ]) {
        const { client, verifier } = arrange({ [kind]: override });
        const res = await verifier.verify(input);
        expect(res.verified, JSON.stringify(override)).toBe(false);
        expect(client.verify).not.toHaveBeenCalled();
      }
    });

    it.each([{ status: 'failed' }, { status: 'unsupported' }])(
      'rejects an evaluation report with status $status even when mandatory_passed is true',
      async (override) => {
        const { client, verifier } = arrange({ evaluation: override });
        const res = await verifier.verify(input);
        expect(res.verified).toBe(false);
        expect(client.verify).not.toHaveBeenCalled();
      },
    );

    it('rejects an evaluation id passed as validation_id and the reverse', async () => {
      const { verifier } = arrange();
      expect((await verifier.verify({ ...input, validation_id: 'eval_200' })).verified).toBe(false);
      expect((await verifier.verify({ ...input, evaluation_id: 'val_100' })).verified).toBe(false);
    });

    it('rethrows a runtime outage so the caller can retry', async () => {
      const outage = new ProductError(503, 'SYS_UNAVAILABLE', 'down', true, { kind: 'dependency_down' });
      const { verifier } = arrange({}, vi.fn().mockRejectedValue(outage));
      await expect(verifier.verify(input)).rejects.toBe(outage);
    });

    it('reports an unexpected error as unverified without echoing its message', async () => {
      const { verifier } = arrange({}, vi.fn().mockRejectedValue(new Error('secret internal detail')));
      expect(await verifier.verify(input)).toEqual({ verified: false, reason: 'Runtime verification failed' });
    });
  });

  describe('report integrity at insert', () => {
    const ctx = { requestId: 'req_i', traceId: 'trace_i' };
    const command = { expected_revision: 2, content_hash: 'sha256:def_hash', idempotency_key: 'key_i' };
    const base = {
      experience_id: 'exp_1',
      draft_revision: 2,
      content_hash: 'sha256:def_hash',
      definition_schema_version: '1.0',
      engine_version: '1.0.0',
      status: 'passed' as const,
      mandatory_passed: true,
      created_at: '2026-11-03T10:00:00Z',
    };

    beforeEach(() => {
      vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
      vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
        draft_id: 'draft_1',
        experience_id: 'exp_1',
        revision: 2,
        content_hash: 'sha256:def_hash',
        content: { def: true },
        updated_by: 'admin',
        updated_at: new Date(),
      });
    });

    afterEach(() => {
      setExperienceRuntimeClient(null);
    });

    it.each([
      { experience_id: 'exp_other' },
      { content_hash: 'sha256:other' },
      { draft_revision: 1 },
    ])('does not store a validation report that differs from the request (%o)', async (override) => {
      const report = { ...base, id: 'val_x', issues: [], ...override };
      setExperienceRuntimeClient({ validate: vi.fn().mockResolvedValue(report), evaluate: vi.fn(), verify: vi.fn() });
      await expect(validateExperienceDraft(mockDb, 'exp_1', command, ctx)).rejects.toMatchObject({
        status: 503,
        details: { kind: 'report_mismatch' },
      });
      expect(repo.insertExperienceReport).not.toHaveBeenCalled();
      expect(repo.saveIdempotencyRecord).not.toHaveBeenCalled();
    });

    it.each([
      { experience_id: 'exp_other' },
      { content_hash: 'sha256:other' },
      { draft_revision: 1 },
    ])('does not store an evaluation report that differs from the request (%o)', async (override) => {
      const report = { ...base, id: 'eval_x', cases: [], ...override };
      setExperienceRuntimeClient({ validate: vi.fn(), evaluate: vi.fn().mockResolvedValue(report), verify: vi.fn() });
      await expect(evaluateExperienceDraft(mockDb, 'exp_1', command, ctx)).rejects.toMatchObject({
        status: 503,
        details: { kind: 'report_mismatch' },
      });
      expect(repo.insertExperienceReport).not.toHaveBeenCalled();
      expect(repo.saveIdempotencyRecord).not.toHaveBeenCalled();
    });
  });
});
