import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductDatabase } from '@/infrastructure/db/client';
import * as repo from '@/modules/experiences/experiences.repository';
import { setPublishReportVerifier } from '@/modules/experiences/experiences.reports';
import { setExperienceRuntimeClient } from '@/modules/experiences/runtime-client';
import { publishExperienceRelease } from '@/modules/experiences/experiences.service';

vi.mock('@/modules/experiences/experiences.repository');

const mockDb = {} as ProductDatabase;
const mockAdmin = { sub: 'admin-user' };

const sampleValidContent = {
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

describe('Experience Validation Gate AT-03 / AT-04 Requirements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(repo.withIdempotencyLock).mockImplementation((db, _scope, _key, work) => work(db));
    vi.mocked(repo.findIdempotencyRecord).mockResolvedValue(undefined);
  });

  afterEach(() => {
    setPublishReportVerifier(null);
    setExperienceRuntimeClient(null);
  });

  it('blocks publishing when validation report is missing', async () => {
    vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
      draft_id: 'd_1',
      experience_id: 'exp_1',
      revision: 1,
      content_hash: 'sha256:hash_1',
      content: sampleValidContent,
      updated_by: 'admin',
      updated_at: new Date(),
    });
    vi.mocked(repo.findReportById).mockResolvedValue(undefined);

    await expect(
      publishExperienceRelease(
        mockDb,
        'exp_1',
        {
          expected_draft_revision: 1,
          content_hash: 'sha256:hash_1',
          validation_id: 'val_missing',
          evaluation_id: 'eval_1',
          approval_refs: [],
          idempotency_key: 'pub_key_missing_val',
        },
        mockAdmin,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: 'PUBLISH_GATE_FAILED',
      details: {
        issues: [
          expect.objectContaining({
            message: expect.stringContaining("Validation report 'val_missing' not found"),
          }),
        ],
      },
    });
  });

  it('blocks publishing when evaluation report failed mandatory cases', async () => {
    vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
      draft_id: 'd_1',
      experience_id: 'exp_1',
      revision: 1,
      content_hash: 'sha256:hash_1',
      content: sampleValidContent,
      updated_by: 'admin',
      updated_at: new Date(),
    });
    vi.mocked(repo.findReportById).mockImplementation(async (_db, id) => {
      if (id === 'val_1') {
        return {
          id: 'val_1',
          experience_id: 'exp_1',
          kind: 'validation',
          draft_revision: 1,
          content_hash: 'sha256:hash_1',
          definition_schema_version: '1.0',
          engine_version: '1.0.0',
          status: 'passed',
          mandatory_passed: true,
          report: {},
          created_at: new Date(),
        };
      }
      if (id === 'eval_failed_mand') {
        return {
          id: 'eval_failed_mand',
          experience_id: 'exp_1',
          kind: 'evaluation',
          draft_revision: 1,
          content_hash: 'sha256:hash_1',
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

    await expect(
      publishExperienceRelease(
        mockDb,
        'exp_1',
        {
          expected_draft_revision: 1,
          content_hash: 'sha256:hash_1',
          validation_id: 'val_1',
          evaluation_id: 'eval_failed_mand',
          approval_refs: [],
          idempotency_key: 'pub_key_mand_fail',
        },
        mockAdmin,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: 'PUBLISH_GATE_FAILED',
      details: {
        issues: [
          expect.objectContaining({
            message: expect.stringContaining('did not pass mandatory cases'),
          }),
        ],
      },
    });
  });

  it('blocks publishing when report was generated for a different content hash', async () => {
    vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
      draft_id: 'd_1',
      experience_id: 'exp_1',
      revision: 1,
      content_hash: 'sha256:current_hash',
      content: sampleValidContent,
      updated_by: 'admin',
      updated_at: new Date(),
    });
    vi.mocked(repo.findReportById).mockImplementation(async (_db, id) => {
      if (id === 'val_old_hash') {
        return {
          id: 'val_old_hash',
          experience_id: 'exp_1',
          kind: 'validation',
          draft_revision: 1,
          content_hash: 'sha256:old_hash',
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

    await expect(
      publishExperienceRelease(
        mockDb,
        'exp_1',
        {
          expected_draft_revision: 1,
          content_hash: 'sha256:current_hash',
          validation_id: 'val_old_hash',
          evaluation_id: 'eval_1',
          approval_refs: [],
          idempotency_key: 'pub_key_diff_hash',
        },
        mockAdmin,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: 'PUBLISH_GATE_FAILED',
      details: {
        issues: [
          expect.objectContaining({
            message: 'Validation report does not match draft snapshot',
          }),
        ],
      },
    });
  });

  it('fails closed when remote runtime verify encounters an outage or returns 5xx', async () => {
    vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
      draft_id: 'd_1',
      experience_id: 'exp_1',
      revision: 1,
      content_hash: 'sha256:hash_1',
      content: sampleValidContent,
      updated_by: 'admin',
      updated_at: new Date(),
    });
    vi.mocked(repo.findReportById).mockImplementation(async (_db, id) => {
      return {
        id,
        experience_id: 'exp_1',
        kind: id === 'val_1' ? 'validation' : 'evaluation',
        draft_revision: 1,
        content_hash: 'sha256:hash_1',
        definition_schema_version: '1.0',
        engine_version: '1.0.0',
        status: 'passed',
        mandatory_passed: true,
        report: {},
        created_at: new Date(),
      };
    });

    setExperienceRuntimeClient({
      validate: vi.fn(),
      evaluate: vi.fn(),
      verify: vi.fn().mockRejectedValue(new Error('Connection refused by runtime')),
    });

    await expect(
      publishExperienceRelease(
        mockDb,
        'exp_1',
        {
          expected_draft_revision: 1,
          content_hash: 'sha256:hash_1',
          validation_id: 'val_1',
          evaluation_id: 'eval_1',
          approval_refs: [],
          idempotency_key: 'pub_key_runtime_down',
        },
        mockAdmin,
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: 'PUBLISH_GATE_FAILED',
      details: {
        issues: [
          expect.objectContaining({
            message: 'Connection refused by runtime',
          }),
        ],
      },
    });
  });

  it('verifies report and successfully publishes when all gates pass', async () => {
    vi.mocked(repo.findDraftByExperienceId).mockResolvedValue({
      draft_id: 'd_1',
      experience_id: 'exp_1',
      revision: 1,
      content_hash: 'sha256:hash_1',
      content: sampleValidContent,
      updated_by: 'admin',
      updated_at: new Date(),
    });
    vi.mocked(repo.findReportById).mockImplementation(async (_db, id) => {
      return {
        id,
        experience_id: 'exp_1',
        kind: id === 'val_1' ? 'validation' : 'evaluation',
        draft_revision: 1,
        content_hash: 'sha256:hash_1',
        definition_schema_version: '1.0',
        engine_version: '1.0.0',
        status: 'passed',
        mandatory_passed: true,
        report: {},
        created_at: new Date(),
      };
    });
    vi.mocked(repo.findReleaseById).mockResolvedValue(undefined);
    vi.mocked(repo.insertExperienceRelease).mockResolvedValue({
      status: 'ok',
      release: {
        id: 'rel_success_1',
        experience_id: 'exp_1',
        definition_version: '1.0.0',
        definition_hash: 'sha256:hash_1',
        definition_schema_version: '1.0',
        engine_version: '1.0.0',
        is_demo: false,
        approval_refs: [],
        validation_id: 'val_1',
        evaluation_id: 'eval_1',
        content: sampleValidContent,
        published_at: new Date(),
        published_by: 'admin-user',
      },
    });

    setExperienceRuntimeClient({
      validate: vi.fn(),
      evaluate: vi.fn(),
      verify: vi.fn().mockResolvedValue({ verified: true, reason: null }),
    });

    const result = await publishExperienceRelease(
      mockDb,
      'exp_1',
      {
        expected_draft_revision: 1,
        content_hash: 'sha256:hash_1',
        validation_id: 'val_1',
        evaluation_id: 'eval_1',
        approval_refs: [],
        idempotency_key: 'pub_key_pass',
      },
      mockAdmin,
    );

    expect(result.status).toBe(201);
    expect(result.data.id).toBe('rel_success_1');
    expect(repo.insertExperienceRelease).toHaveBeenCalled();
  });
});
