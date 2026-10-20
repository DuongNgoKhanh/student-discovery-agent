import { dispatch } from '../helpers/api';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { call, json, validateEnvelope } from '../helpers/users-api';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { closeProductDatabase, getProductDatabase } from '@/infrastructure/db/client';
import { issueAccessToken } from '@/modules/auth/tokens';
import { computeContentHash } from '@/modules/experiences/canonical';

let pg: PostgresHandle;
let admin: string;
let userToken: string;

beforeAll(async () => {
  pg = await startPostgres();
  await migrateProduct(pg.url);
});

afterAll(async () => {
  try {
    await closeProductDatabase();
  } finally {
    await pg?.stop();
  }
});

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv('DATABASE_URL', pg.url);
  vi.stubEnv('SECRET_KEY', 'integration-test-secret');
  admin = await issueAccessToken('admin', true);
  userToken = await issueAccessToken('123', false);
});

const validDefinition = {
  schema_version: '1.0',
  definition_id: 'personality_assessment_mvp',
  definition_version: '1.0.0',
  engine_version: '1.0.0',
  is_demo: false,
  questions: [
    { question_id: 'q1', text: 'Question 1' },
    { question_id: 'q2', text: 'Question 2' },
    { question_id: 'q3', text: 'Question 3' },
    { question_id: 'q4', text: 'Question 4' },
    { question_id: 'q5', text: 'Question 5' },
    { question_id: 'q6', text: 'Question 6' },
  ],
  houses: [
    { house_id: 'h1', name: 'House 1' },
    { house_id: 'h2', name: 'House 2' },
    { house_id: 'h3', name: 'House 3' },
    { house_id: 'h4', name: 'House 4' },
    { house_id: 'h5', name: 'House 5' },
    { house_id: 'h6', name: 'House 6' },
  ],
  selection_rules: { type: 'all' },
  scoring_rules: { type: 'sum' },
  coverage_rules: { type: 'complete' },
  tie_policy: { type: 'random' },
  templates: { result: 'Result template' },
  evaluation_cases: [],
  approval_refs: ['appr_qa_pass'],
};

describe('Experiences and Releases API (A-01 integration)', () => {
  it('1. Create experience -> draft revision 0 with draft_ref', async () => {
    const res = await dispatch(
      call('POST', '/admin/experiences', admin, {
        name: 'MVP Personality Assessment',
        description: 'First experience test',
        activity_type: 'personality_assessment',
        idempotency_key: 'create_exp_001',
      }),
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expect(validateEnvelope(body), JSON.stringify(validateEnvelope.errors)).toBe(true);
    expect(body.data.id).toMatch(/^exp_[a-f0-9]+$/);
    expect(body.data.revision).toBe(0);
    expect(body.data.created_at.endsWith('Z')).toBe(true);
    expect(body.data.updated_at.endsWith('Z')).toBe(true);
    expect(body.data.draft_ref).toMatchObject({
      revision: 0,
      content_hash: computeContentHash({}),
    });
  });

  it('2. GET draft returns initial revision 0, hash, content, updated_by', async () => {
    const createRes = await json(
      await dispatch(
        call('POST', '/admin/experiences', admin, {
          name: 'Exp for draft read',
          activity_type: 'personality_assessment',
          idempotency_key: 'create_exp_002',
        }),
      ),
    );
    const expId = createRes.data.id as string;

    const draftRes = await dispatch(call('GET', `/admin/experiences/${expId}/draft`, admin));
    expect(draftRes.status).toBe(200);
    const body = await json(draftRes);
    expect(validateEnvelope(body), JSON.stringify(validateEnvelope.errors)).toBe(true);
    expect(body.data).toMatchObject({
      experience_id: expId,
      revision: 0,
      content_hash: computeContentHash({}),
      content: {},
      updated_by: 'admin',
    });
  });

  it('3. Incomplete draft saves (revision 1); malformed, non-finite, and duplicate keys rejected (AT-02.2)', async () => {
    const createRes = await json(
      await dispatch(
        call('POST', '/admin/experiences', admin, {
          name: 'Exp for draft save',
          activity_type: 'personality_assessment',
          idempotency_key: 'create_exp_003',
        }),
      ),
    );
    const expId = createRes.data.id as string;

    // Incomplete draft is allowed
    const saveRes = await dispatch(
      call('PUT', `/admin/experiences/${expId}/draft`, admin, {
        expected_revision: 0,
        idempotency_key: 'save_draft_003',
        content: { questions: [] },
      }),
    );
    expect(saveRes.status).toBe(200);
    const saveBody = await json(saveRes);
    expect(saveBody.data.revision).toBe(1);
    expect(saveBody.data.content).toEqual({ questions: [] });
    expect(saveBody.data.content_hash).toBe(computeContentHash({ questions: [] }));

    // Malformed JSON rejected
    const malformed = await dispatch(
      new Request(`http://localhost/api/v1/admin/experiences/${expId}/draft`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: '{ "expected_revision": 1, "content": ',
      }),
    );
    expect(malformed.status).toBe(400);

    // Duplicate keys rejected
    const dupKey = await dispatch(
      new Request(`http://localhost/api/v1/admin/experiences/${expId}/draft`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: '{"expected_revision": 1, "idempotency_key": "k_dup", "idempotency_key": "k_dup2", "content": {}}',
      }),
    );
    expect(dupKey.status).toBe(400);

    // Unsupported content-type rejected
    const nonJson = await dispatch(
      new Request(`http://localhost/api/v1/admin/experiences/${expId}/draft`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'text/plain' },
        body: 'plain text',
      }),
    );
    expect(nonJson.status).toBe(415);
  });

  it('4. Concurrent saves with same expected_revision: exactly one 200 and one 409 REVISION_CONFLICT (AT-02.3)', async () => {
    const createRes = await json(
      await dispatch(
        call('POST', '/admin/experiences', admin, {
          name: 'Exp for concurrent saves',
          activity_type: 'personality_assessment',
          idempotency_key: 'create_exp_004',
        }),
      ),
    );
    const expId = createRes.data.id as string;

    const [res1, res2] = await Promise.all([
      dispatch(
        call('PUT', `/admin/experiences/${expId}/draft`, admin, {
          expected_revision: 0,
          idempotency_key: 'conc_save_1',
          content: { client: 1 },
        }),
      ),
      dispatch(
        call('PUT', `/admin/experiences/${expId}/draft`, admin, {
          expected_revision: 0,
          idempotency_key: 'conc_save_2',
          content: { client: 2 },
        }),
      ),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const conflictRes = res1.status === 409 ? res1 : res2;
    const conflictBody = await json(conflictRes);
    expect(conflictBody.error.code).toBe('REVISION_CONFLICT');
    expect(conflictBody.error.details).toMatchObject({
      expected_revision: 0,
      actual_revision: 1,
    });
  });

  it('5. Idempotent replay returns cached response before revision check; collision returns 409', async () => {
    const createRes = await json(
      await dispatch(
        call('POST', '/admin/experiences', admin, {
          name: 'Exp for idempotency',
          activity_type: 'personality_assessment',
          idempotency_key: 'create_exp_005',
        }),
      ),
    );
    const expId = createRes.data.id as string;

    // First save
    const save1 = await json(
      await dispatch(
        call('PUT', `/admin/experiences/${expId}/draft`, admin, {
          expected_revision: 0,
          idempotency_key: 'idem_key_005',
          content: { step: 1 },
        }),
      ),
    );
    expect(save1.data.revision).toBe(1);

    // Save again to advance revision to 2
    const save2 = await json(
      await dispatch(
        call('PUT', `/admin/experiences/${expId}/draft`, admin, {
          expected_revision: 1,
          idempotency_key: 'other_save_key',
          content: { step: 2 },
        }),
      ),
    );
    expect(save2.data.revision).toBe(2);

    // Replay of first save with expected_revision: 0 and original payload
    // Even though current revision is now 2, idempotency replay MUST succeed before revision check!
    const replayRes = await dispatch(
      call('PUT', `/admin/experiences/${expId}/draft`, admin, {
        expected_revision: 0,
        idempotency_key: 'idem_key_005',
        content: { step: 1 },
      }),
    );
    expect(replayRes.status).toBe(200);
    const replayBody = await json(replayRes);
    expect(replayBody.data.revision).toBe(1);

    // Reuse same key with different payload -> 409 IDEMPOTENCY_KEY_COLLISION
    const collisionRes = await dispatch(
      call('PUT', `/admin/experiences/${expId}/draft`, admin, {
        expected_revision: 2,
        idempotency_key: 'idem_key_005',
        content: { different: true },
      }),
    );
    expect(collisionRes.status).toBe(409);
    const collisionBody = await json(collisionRes);
    expect(collisionBody.error.code).toBe('IDEMPOTENCY_KEY_COLLISION');
  });

  it('6. Publish release: validation gate, hash match, duplicate version rejection, and immutable release creation', async () => {
    const createRes = await json(
      await dispatch(
        call('POST', '/admin/experiences', admin, {
          name: 'Exp for publish',
          activity_type: 'personality_assessment',
          idempotency_key: 'create_exp_006',
        }),
      ),
    );
    const expId = createRes.data.id as string;

    // Incomplete draft saved
    await dispatch(
      call('PUT', `/admin/experiences/${expId}/draft`, admin, {
        expected_revision: 0,
        idempotency_key: 'save_inc_006',
        content: { questions: [] },
      }),
    );

    const incHash = computeContentHash({ questions: [] });

    // Attempt publish on incomplete draft -> 422 PUBLISH_GATE_FAILED
    const gateFailRes = await dispatch(
      call('POST', `/admin/experiences/${expId}/releases`, admin, {
        expected_revision: 1,
        content_hash: incHash,
        validation_id: 'val_test_1',
        evaluation_id: 'eval_test_1',
        approval_refs: ['appr_qa_pass'],
        idempotency_key: 'pub_key_inc',
      }),
    );
    expect(gateFailRes.status).toBe(422);
    const gateFailBody = await json(gateFailRes);
    expect(gateFailBody.error.code).toBe('PUBLISH_GATE_FAILED');

    // Save structurally valid definition document
    await dispatch(
      call('PUT', `/admin/experiences/${expId}/draft`, admin, {
        expected_revision: 1,
        idempotency_key: 'save_valid_006',
        content: validDefinition,
      }),
    );
    const validHash = computeContentHash(validDefinition);

    // Stale content hash -> 409 STALE_REPORT
    const staleHashRes = await dispatch(
      call('POST', `/admin/experiences/${expId}/releases`, admin, {
        expected_revision: 2,
        content_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        validation_id: 'val_test_1',
        evaluation_id: 'eval_test_1',
        approval_refs: ['appr_qa_pass'],
        idempotency_key: 'pub_key_stale_hash',
      }),
    );
    expect(staleHashRes.status).toBe(409);
    const staleHashBody = await json(staleHashRes);
    expect(staleHashBody.error.code).toBe('STALE_REPORT');

    // Stale revision -> 409 REVISION_CONFLICT
    const staleRevRes = await dispatch(
      call('POST', `/admin/experiences/${expId}/releases`, admin, {
        expected_revision: 1,
        content_hash: validHash,
        validation_id: 'val_test_1',
        evaluation_id: 'eval_test_1',
        approval_refs: ['appr_qa_pass'],
        idempotency_key: 'pub_key_stale_rev',
      }),
    );
    expect(staleRevRes.status).toBe(409);
    const staleRevBody = await json(staleRevRes);
    expect(staleRevBody.error.code).toBe('REVISION_CONFLICT');

    // Valid publish succeeds -> 201
    const pubRes = await dispatch(
      call('POST', `/admin/experiences/${expId}/releases`, admin, {
        expected_revision: 2,
        content_hash: validHash,
        validation_id: 'val_test_1',
        evaluation_id: 'eval_test_1',
        approval_refs: ['appr_qa_pass'],
        idempotency_key: 'pub_key_success',
      }),
    );
    expect(pubRes.status).toBe(201);
    const pubBody = await json(pubRes);
    expect(validateEnvelope(pubBody), JSON.stringify(validateEnvelope.errors)).toBe(true);
    expect(pubBody.data.id).toMatch(/^exp_rel_[a-f0-9]+$/);
    expect(pubBody.data.definition_version).toBe('1.0.0');
    expect(pubBody.data.definition_hash).toBe(validHash);

    // Replay returns cached release
    const replayPub = await dispatch(
      call('POST', `/admin/experiences/${expId}/releases`, admin, {
        expected_revision: 2,
        content_hash: validHash,
        validation_id: 'val_test_1',
        evaluation_id: 'eval_test_1',
        approval_refs: ['appr_qa_pass'],
        idempotency_key: 'pub_key_success',
      }),
    );
    expect(replayPub.status).toBe(201);
    const replayBody = await json(replayPub);
    expect(replayBody.data.id).toBe(pubBody.data.id);

    // Duplicate definition_version on same experience -> 409 REVISION_CONFLICT
    await dispatch(
      call('PUT', `/admin/experiences/${expId}/draft`, admin, {
        expected_revision: 2,
        idempotency_key: 'save_draft_dup_ver',
        content: { ...validDefinition, templates: { result: 'Modified template' } },
      }),
    );
    const dupVerHash = computeContentHash({ ...validDefinition, templates: { result: 'Modified template' } });
    const dupVerPub = await dispatch(
      call('POST', `/admin/experiences/${expId}/releases`, admin, {
        expected_revision: 3,
        content_hash: dupVerHash,
        validation_id: 'val_test_2',
        evaluation_id: 'eval_test_2',
        approval_refs: ['appr_qa_pass'],
        idempotency_key: 'pub_key_dup_ver',
      }),
    );
    expect(dupVerPub.status).toBe(409);
    const dupVerBody = await json(dupVerPub);
    expect(dupVerBody.error.code).toBe('REVISION_CONFLICT');
    expect(dupVerBody.error.message).toMatch(/already exists/i);
  });

  it('7. Immutability of releases: edits to draft do not change release; direct SQL update fails (AT-04, FR-CFG-05)', async () => {
    const createRes = await json(
      await dispatch(
        call('POST', '/admin/experiences', admin, {
          name: 'Exp for immutability test',
          activity_type: 'personality_assessment',
          idempotency_key: 'create_exp_007',
        }),
      ),
    );
    const expId = createRes.data.id as string;

    await dispatch(
      call('PUT', `/admin/experiences/${expId}/draft`, admin, {
        expected_revision: 0,
        idempotency_key: 'save_draft_007',
        content: validDefinition,
      }),
    );
    const hash = computeContentHash(validDefinition);

    const pubRes = await json(
      await dispatch(
        call('POST', `/admin/experiences/${expId}/releases`, admin, {
          expected_revision: 1,
          content_hash: hash,
          validation_id: 'val_1',
          evaluation_id: 'eval_1',
          approval_refs: ['appr_1'],
          idempotency_key: 'pub_007',
        }),
      ),
    );
    const releaseId = pubRes.data.id as string;

    // Mutate draft afterwards
    await dispatch(
      call('PUT', `/admin/experiences/${expId}/draft`, admin, {
        expected_revision: 1,
        idempotency_key: 'save_draft_after',
        content: { ...validDefinition, definition_version: '2.0.0' },
      }),
    );

    // Read release by id: unchanged
    const readRel = await json(
      await dispatch(call('GET', `/admin/experience-releases/${releaseId}`, admin)),
    );
    expect(readRel.data.definition_version).toBe('1.0.0');
    expect(readRel.data.definition_hash).toBe(hash);

    // List releases: unchanged
    const listRel = await json(
      await dispatch(call('GET', `/admin/experiences/${expId}/releases`, admin)),
    );
    expect(listRel.data.items).toHaveLength(1);
    expect(listRel.data.items[0].id).toBe(releaseId);

    // Direct SQL UPDATE on product.experience_releases must fail via trigger
    const db = getProductDatabase();
    let updateError: unknown;
    try {
      await db.execute(`UPDATE product.experience_releases SET definition_version = '9.9.9' WHERE id = '${releaseId}'`);
    } catch (err) {
      updateError = err;
    }
    expect(updateError).toBeDefined();
    const updateErrorMsg = `${(updateError as Error).message} ${String((updateError as { cause?: Error }).cause?.message ?? '')}`;
    expect(updateErrorMsg).toMatch(/experience_releases is immutable/i);

    // Direct SQL DELETE on product.experience_releases must fail via trigger
    let deleteError: unknown;
    try {
      await db.execute(`DELETE FROM product.experience_releases WHERE id = '${releaseId}'`);
    } catch (err) {
      deleteError = err;
    }
    expect(deleteError).toBeDefined();
    const deleteErrorMsg = `${(deleteError as Error).message} ${String((deleteError as { cause?: Error }).cause?.message ?? '')}`;
    expect(deleteErrorMsg).toMatch(/experience_releases is immutable/i);
  });

  it('8. PATCH metadata: updates name/description with expected_revision; stale revision -> 409', async () => {
    const createRes = await json(
      await dispatch(
        call('POST', '/admin/experiences', admin, {
          name: 'Original Name',
          description: 'Original Desc',
          activity_type: 'personality_assessment',
          idempotency_key: 'create_exp_008',
        }),
      ),
    );
    const expId = createRes.data.id as string;
    expect(createRes.data.revision).toBe(0);

    // Successful PATCH
    const patchRes = await dispatch(
      call('PATCH', `/admin/experiences/${expId}`, admin, {
        expected_revision: 0,
        idempotency_key: 'patch_key_008',
        name: 'Patched Name',
      }),
    );
    expect(patchRes.status).toBe(200);
    const patchBody = await json(patchRes);
    expect(patchBody.data.name).toBe('Patched Name');
    expect(patchBody.data.description).toBe('Original Desc');
    expect(patchBody.data.revision).toBe(1);

    // Stale PATCH -> 409 REVISION_CONFLICT
    const stalePatch = await dispatch(
      call('PATCH', `/admin/experiences/${expId}`, admin, {
        expected_revision: 0,
        idempotency_key: 'patch_key_stale',
        name: 'Another Name',
      }),
    );
    expect(stalePatch.status).toBe(409);
    const staleBody = await json(stalePatch);
    expect(staleBody.error.code).toBe('REVISION_CONFLICT');
  });

  it('9. Auth guards: unauthenticated 401, non-admin 403 on all experience endpoints', async () => {
    expect((await dispatch(call('GET', '/admin/experiences'))).status).toBe(401);
    expect((await dispatch(call('GET', '/admin/experiences', userToken))).status).toBe(403);
    expect((await dispatch(call('GET', '/admin/experiences/exp_1', userToken))).status).toBe(403);
    expect((await dispatch(call('GET', '/admin/experiences/exp_1/draft', userToken))).status).toBe(403);
    expect((await dispatch(call('GET', '/admin/experience-releases/rel_1', userToken))).status).toBe(403);
  });
});
