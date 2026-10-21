import { dispatch } from '../helpers/api';
import { declaredResponseValidator } from '../helpers/openapi-response';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { call, json, validateEnvelope } from '../helpers/users-api';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { closeProductDatabase, getProductDatabase } from '@/infrastructure/db/client';
import { issueAccessToken } from '@/modules/auth/tokens';
import { computeContentHash } from '@/modules/experiences/canonical';
import { setPublishReportVerifier } from '@/modules/experiences/experiences.reports';
import { experiences } from '@/infrastructure/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';

let pg: PostgresHandle;
let admin: string;
let userToken: string;

beforeAll(async () => {
  pg = await startPostgres();
  await migrateProduct(pg.url);
});

afterAll(async () => {
  setPublishReportVerifier(null);
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
  // No A-02/C-05 report service exists yet; release-path tests inject an accepting verifier explicitly.
  setPublishReportVerifier({ verify: async () => true });
});

async function createWithValidDraft(suffix: string): Promise<{ expId: string; hash: string }> {
  const created = await json(
    await dispatch(
      call('POST', '/admin/experiences', admin, {
        name: `Exp ${suffix}`,
        activity_type: 'personality_assessment',
        idempotency_key: `create_${suffix}`,
      }),
    ),
  );
  const expId = created.data.id as string;
  const saved = await dispatch(
    call('PUT', `/admin/experiences/${expId}/draft`, admin, {
      expected_draft_revision: 0,
      idempotency_key: `draft_${suffix}`,
      content: validDefinition,
    }),
  );
  expect(saved.status).toBe(200);
  return { expId, hash: computeContentHash(validDefinition) };
}

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
    expect(body.data.metadata_revision).toBe(0);
    expect(body.data.created_at.endsWith('Z')).toBe(true);
    expect(body.data.updated_at.endsWith('Z')).toBe(true);
    expect(body.data.draft_ref).toMatchObject({
      draft_revision: 0,
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
      draft_revision: 0,
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
        expected_draft_revision: 0,
        idempotency_key: 'save_draft_003',
        content: { questions: [] },
      }),
    );
    expect(saveRes.status).toBe(200);
    const saveBody = await json(saveRes);
    expect(saveBody.data.draft_revision).toBe(1);
    expect(saveBody.data.content).toEqual({ questions: [] });
    expect(saveBody.data.content_hash).toBe(computeContentHash({ questions: [] }));

    // Malformed JSON rejected
    const malformed = await dispatch(
      new Request(`http://localhost/api/v1/admin/experiences/${expId}/draft`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: '{ "expected_draft_revision": 1, "content": ',
      }),
    );
    expect(malformed.status).toBe(400);

    // Duplicate keys rejected
    const dupKey = await dispatch(
      new Request(`http://localhost/api/v1/admin/experiences/${expId}/draft`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: '{"expected_draft_revision": 1, "idempotency_key": "k_dup", "idempotency_key": "k_dup2", "content": {}}',
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

  it('4. Concurrent saves with same expected_draft_revision: exactly one 200 and one 409 CONFLICT_REVISION (AT-02.3)', async () => {
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
          expected_draft_revision: 0,
          idempotency_key: 'conc_save_1',
          content: { client: 1 },
        }),
      ),
      dispatch(
        call('PUT', `/admin/experiences/${expId}/draft`, admin, {
          expected_draft_revision: 0,
          idempotency_key: 'conc_save_2',
          content: { client: 2 },
        }),
      ),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const conflictRes = res1.status === 409 ? res1 : res2;
    const conflictBody = await json(conflictRes);
    expect(conflictBody.error.code).toBe('CONFLICT_REVISION');
    expect(conflictBody.error.details).toMatchObject({
      expected_draft_revision: 0,
      actual_draft_revision: 1,
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
          expected_draft_revision: 0,
          idempotency_key: 'idem_key_005',
          content: { step: 1 },
        }),
      ),
    );
    expect(save1.data.draft_revision).toBe(1);

    // Save again to advance revision to 2
    const save2 = await json(
      await dispatch(
        call('PUT', `/admin/experiences/${expId}/draft`, admin, {
          expected_draft_revision: 1,
          idempotency_key: 'other_save_key',
          content: { step: 2 },
        }),
      ),
    );
    expect(save2.data.draft_revision).toBe(2);

    // Replay of first save with expected_draft_revision: 0 and original payload
    // Even though current revision is now 2, idempotency replay MUST succeed before revision check!
    const replayRes = await dispatch(
      call('PUT', `/admin/experiences/${expId}/draft`, admin, {
        expected_draft_revision: 0,
        idempotency_key: 'idem_key_005',
        content: { step: 1 },
      }),
    );
    expect(replayRes.status).toBe(200);
    const replayBody = await json(replayRes);
    expect(replayBody.data.draft_revision).toBe(1);

    // Reuse same key with different payload -> 409 CONFLICT_IDEMPOTENCY_KEY
    const collisionRes = await dispatch(
      call('PUT', `/admin/experiences/${expId}/draft`, admin, {
        expected_draft_revision: 2,
        idempotency_key: 'idem_key_005',
        content: { different: true },
      }),
    );
    expect(collisionRes.status).toBe(409);
    const collisionBody = await json(collisionRes);
    expect(collisionBody.error.code).toBe('CONFLICT_IDEMPOTENCY_KEY');
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
        expected_draft_revision: 0,
        idempotency_key: 'save_inc_006',
        content: { questions: [] },
      }),
    );

    const incHash = computeContentHash({ questions: [] });

    // Attempt publish on incomplete draft -> 422 PUBLISH_GATE_FAILED
    const gateFailRes = await dispatch(
      call('POST', `/admin/experiences/${expId}/releases`, admin, {
        expected_draft_revision: 1,
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
        expected_draft_revision: 1,
        idempotency_key: 'save_valid_006',
        content: validDefinition,
      }),
    );
    const validHash = computeContentHash(validDefinition);

    // Stale content hash -> 409 CONFLICT_STALE_REPORT
    const staleHashRes = await dispatch(
      call('POST', `/admin/experiences/${expId}/releases`, admin, {
        expected_draft_revision: 2,
        content_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        validation_id: 'val_test_1',
        evaluation_id: 'eval_test_1',
        approval_refs: ['appr_qa_pass'],
        idempotency_key: 'pub_key_stale_hash',
      }),
    );
    expect(staleHashRes.status).toBe(409);
    const staleHashBody = await json(staleHashRes);
    expect(staleHashBody.error.code).toBe('CONFLICT_STALE_REPORT');

    // Stale revision -> 409 CONFLICT_REVISION
    const staleRevRes = await dispatch(
      call('POST', `/admin/experiences/${expId}/releases`, admin, {
        expected_draft_revision: 1,
        content_hash: validHash,
        validation_id: 'val_test_1',
        evaluation_id: 'eval_test_1',
        approval_refs: ['appr_qa_pass'],
        idempotency_key: 'pub_key_stale_rev',
      }),
    );
    expect(staleRevRes.status).toBe(409);
    const staleRevBody = await json(staleRevRes);
    expect(staleRevBody.error.code).toBe('CONFLICT_REVISION');

    // Valid publish succeeds -> 201
    const pubRes = await dispatch(
      call('POST', `/admin/experiences/${expId}/releases`, admin, {
        expected_draft_revision: 2,
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
        expected_draft_revision: 2,
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

    // Duplicate definition_version on same experience -> 409 CONFLICT_REVISION
    await dispatch(
      call('PUT', `/admin/experiences/${expId}/draft`, admin, {
        expected_draft_revision: 2,
        idempotency_key: 'save_draft_dup_ver',
        content: { ...validDefinition, templates: { result: 'Modified template' } },
      }),
    );
    const dupVerHash = computeContentHash({ ...validDefinition, templates: { result: 'Modified template' } });
    const dupVerPub = await dispatch(
      call('POST', `/admin/experiences/${expId}/releases`, admin, {
        expected_draft_revision: 3,
        content_hash: dupVerHash,
        validation_id: 'val_test_2',
        evaluation_id: 'eval_test_2',
        approval_refs: ['appr_qa_pass'],
        idempotency_key: 'pub_key_dup_ver',
      }),
    );
    expect(dupVerPub.status).toBe(409);
    const dupVerBody = await json(dupVerPub);
    expect(dupVerBody.error.code).toBe('CONFLICT_REVISION');
    expect(dupVerBody.error.message).toMatch(/already been published/i);
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
        expected_draft_revision: 0,
        idempotency_key: 'save_draft_007',
        content: validDefinition,
      }),
    );
    const hash = computeContentHash(validDefinition);

    const pubRes = await json(
      await dispatch(
        call('POST', `/admin/experiences/${expId}/releases`, admin, {
          expected_draft_revision: 1,
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
        expected_draft_revision: 1,
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

  it('8. PATCH metadata: updates name/description with expected_metadata_revision; stale revision -> 409', async () => {
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
    expect(createRes.data.metadata_revision).toBe(0);

    // Successful PATCH
    const patchRes = await dispatch(
      call('PATCH', `/admin/experiences/${expId}`, admin, {
        expected_metadata_revision: 0,
        idempotency_key: 'patch_key_008',
        name: 'Patched Name',
      }),
    );
    expect(patchRes.status).toBe(200);
    const patchBody = await json(patchRes);
    expect(patchBody.data.name).toBe('Patched Name');
    expect(patchBody.data.description).toBe('Original Desc');
    expect(patchBody.data.metadata_revision).toBe(1);

    // Stale PATCH -> 409 CONFLICT_REVISION
    const stalePatch = await dispatch(
      call('PATCH', `/admin/experiences/${expId}`, admin, {
        expected_metadata_revision: 0,
        idempotency_key: 'patch_key_stale',
        name: 'Another Name',
      }),
    );
    expect(stalePatch.status).toBe(409);
    const staleBody = await json(stalePatch);
    expect(staleBody.error.code).toBe('CONFLICT_REVISION');
  });

  it('9. Auth guards: unauthenticated 401, non-admin 403 on all experience endpoints', async () => {
    expect((await dispatch(call('GET', '/admin/experiences'))).status).toBe(401);
    expect((await dispatch(call('GET', '/admin/experiences', userToken))).status).toBe(403);
    expect((await dispatch(call('GET', '/admin/experiences/exp_1', userToken))).status).toBe(403);
    expect((await dispatch(call('GET', '/admin/experiences/exp_1/draft', userToken))).status).toBe(403);
    expect((await dispatch(call('GET', '/admin/experience-releases/rel_1', userToken))).status).toBe(403);
  });

  it('10. Publish fails closed when validation/evaluation reports cannot be verified', async () => {
    setPublishReportVerifier(null);
    const { expId, hash } = await createWithValidDraft('closed_010');
    const res = await dispatch(
      call('POST', `/admin/experiences/${expId}/releases`, admin, {
        expected_draft_revision: 1,
        content_hash: hash,
        validation_id: 'val_unverified',
        evaluation_id: 'eval_unverified',
        approval_refs: [],
        idempotency_key: 'pub_closed_010',
      }),
    );
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.error.code).toBe('PUBLISH_GATE_FAILED');
    expect(body.error.details.issues[0].code).toBe('report_unverified');
    const releases = await json(await dispatch(call('GET', `/admin/experiences/${expId}/releases`, admin)));
    expect(releases.data.items).toEqual([]);
  });

  it('11. Concurrent creates with one idempotency key yield one experience and identical responses', async () => {
    const body = { name: 'Exp concurrent 011', activity_type: 'personality_assessment', idempotency_key: 'create_011' };
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => dispatch(call('POST', '/admin/experiences', admin, body))),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(201));
    const bodies = await Promise.all(responses.map((r) => json(r)));
    expect(new Set(bodies.map((b) => b.data.id)).size).toBe(1);
    const rows = await getProductDatabase()
      .select({ id: experiences.id })
      .from(experiences)
      .where(eq(experiences.name, body.name));
    expect(rows).toHaveLength(1);
  });

  it('12. Concurrent publishes with one idempotency key replay the same release', async () => {
    const { expId, hash } = await createWithValidDraft('publish_012');
    const body = {
      expected_draft_revision: 1,
      content_hash: hash,
      validation_id: 'val_012',
      evaluation_id: 'eval_012',
      approval_refs: ['appr_qa_pass'],
      idempotency_key: 'pub_012',
    };
    const responses = await Promise.all([
      dispatch(call('POST', `/admin/experiences/${expId}/releases`, admin, body)),
      dispatch(call('POST', `/admin/experiences/${expId}/releases`, admin, body)),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const [first, second] = await Promise.all(responses.map((r) => json(r)));
    expect(second.data.id).toBe(first.data.id);
    const releases = await json(await dispatch(call('GET', `/admin/experiences/${expId}/releases`, admin)));
    expect(releases.data.items).toHaveLength(1);
  });

  it('13. Keyset pagination keeps rows that share the boundary millisecond; malformed cursors are 400', async () => {
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      const created = await json(
        await dispatch(
          call('POST', '/admin/experiences', admin, {
            name: `Exp page 013 ${n}`,
            activity_type: 'personality_assessment',
            idempotency_key: `create_page_013_${n}`,
          }),
        ),
      );
      ids.push(created.data.id as string);
    }
    // Future timestamps put these rows first; all three fall inside one JS millisecond.
    const db = getProductDatabase();
    for (const [index, id] of ids.entries()) {
      await db
        .update(experiences)
        .set({ created_at: sql`${`2099-01-01T00:00:00.1231${index}0Z`}::timestamptz` })
        .where(eq(experiences.id, id));
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page += 1) {
      const query: string = cursor ? `?limit=1&cursor=${cursor}` : '?limit=1';
      const res = await json(await dispatch(call('GET', `/admin/experiences${query}`, admin)));
      seen.push(...(res.data.items as Array<{ id: string }>).map((item) => item.id));
      cursor = res.meta.pagination.next_cursor as string | null;
    }
    expect(seen).toEqual([...ids].reverse());
    const stored = await db.select({ id: experiences.id }).from(experiences).where(inArray(experiences.id, ids));
    expect(stored).toHaveLength(3);

    const malformed = Buffer.from(JSON.stringify({ created_at: 'not-a-time', id: 'exp_x' })).toString('base64url');
    const bad = await dispatch(call('GET', `/admin/experiences?cursor=${malformed}`, admin));
    expect(bad.status).toBe(400);
    expect((await json(bad)).error.code).toBe('VAL_INVALID_REQUEST');
  });
});

it('no-op metadata/draft writes preserve independent revisions, timestamps and replay', async () => {
  const created = await json(await dispatch(call('POST', '/admin/experiences', admin, {
    name: 'No-op', activity_type: 'personality_assessment', idempotency_key: 'noop_create',
  })));
  const id = created.data.id;
  const patch = { expected_metadata_revision: 0, name: 'No-op', idempotency_key: 'noop_patch' };
  const unchanged = await json(await dispatch(call('PATCH', `/admin/experiences/${id}`, admin, patch)));
  expect(unchanged.data.metadata_revision).toBe(0);
  expect(unchanged.data.updated_at).toBe(created.data.updated_at);
  const initialDraft = await json(await dispatch(call('GET', `/admin/experiences/${id}/draft`, admin)));
  const draft = { expected_draft_revision: 0, content: {}, idempotency_key: 'noop_draft' };
  const unchangedDraft = await json(await dispatch(call('PUT', `/admin/experiences/${id}/draft`, admin, draft)));
  expect(unchangedDraft.data.draft_revision).toBe(0);
  expect(unchangedDraft.data.updated_at).toBe(initialDraft.data.updated_at);
  const changed = await json(await dispatch(call('PATCH', `/admin/experiences/${id}`, admin, { ...patch, name: 'Changed', idempotency_key: 'noop_changed' })));
  expect(changed.data.metadata_revision).toBe(1);
  expect(changed.data.draft_ref.draft_revision).toBe(0);
  const replay = await json(await dispatch(call('PATCH', `/admin/experiences/${id}`, admin, patch)));
  expect(replay.data).toEqual(unchanged.data);
  const stale = await dispatch(call('PATCH', `/admin/experiences/${id}`, admin, { ...patch, idempotency_key: 'noop_stale' }));
  expect(stale.status).toBe(409);
});

it('release cursors cannot be reused across experiences', async () => {
  const { expId, hash } = await createWithValidDraft('cursorbound');
  await dispatch(call('POST', `/admin/experiences/${expId}/releases`, admin, {
    expected_draft_revision: 1, content_hash: hash, validation_id: 'v', evaluation_id: 'e', approval_refs: [], idempotency_key: 'cursorbound_rel',
  }));
  const { encodeReleaseCursor } = await import('@/modules/experiences/experiences.repository');
  const cursor = encodeReleaseCursor({ published_at: new Date(), id: 'rel_1' }, 'exp_different');
  expect((await dispatch(call('GET', `/admin/experiences/${expId}/releases?cursor=${encodeURIComponent(cursor)}`, admin))).status).toBe(400);
});

it.each([
  ['create', 'baseline'], ['patch', 'baseline'], ['draft', 'baseline'], ['publish', 'baseline'],
  ['patch', 'explicit'], ['draft', 'explicit'], ['publish', 'explicit'],
] as const)('replays persisted %s outcomes with %s revision fingerprints after wire upgrade', async (operation, fingerprint) => {
  const { insertExperienceWithDraft, insertExperienceRelease, saveIdempotencyRecord } = await import('@/modules/experiences/experiences.repository');
  const { experienceDrafts, experienceReleases, idempotencyRecords } = await import('@/infrastructure/db/schema');
  const db = getProductDatabase();
  const id = `exp_upgrade_${operation}_${fingerprint}`;
  const key = `upgrade_${operation}_${fingerprint}`;
  await insertExperienceWithDraft(db, { id, name: 'Current metadata', initialDraftContent: { current: true } });
  await db.update(experiences).set({ revision: 8 }).where(eq(experiences.id, id));
  await db.update(experienceDrafts).set({ revision: 9 }).where(eq(experienceDrafts.experience_id, id));
  const timestamp = '2026-10-19T10:00:00.000Z';
  const hash = computeContentHash({ legacy: true, revision: 17 });
  let scope: string;
  let path: string;
  let method: string;
  let payload: Record<string, unknown>;
  let response: Record<string, unknown>;
  let status: number;
  let expected: Record<string, unknown>;
  if (operation === 'create' || operation === 'patch') {
    scope = operation === 'create' ? 'create_experience' : `patch:${id}`;
    path = operation === 'create' ? '/admin/experiences' : `/admin/experiences/${id}`;
    method = operation === 'create' ? 'POST' : 'PATCH';
    payload = operation === 'create'
      ? { name: 'Historical metadata', description: '', activity_type: 'personality_assessment' }
      : { expected_revision: 1, name: 'Historical metadata', description: '' };
    response = { id, revision: operation === 'create' ? 0 : 2, name: 'Historical metadata', description: '', activity_type: 'personality_assessment', created_at: timestamp, updated_at: timestamp,
      draft_ref: { draft_id: `draft_${id}`, revision: 1, content_hash: hash } };
    status = operation === 'create' ? 201 : 200;
    const { revision, draft_ref, ...rest } = response;
    expected = { ...rest, metadata_revision: revision, draft_ref: { ...(draft_ref as object), draft_revision: 1 } };
    delete (expected.draft_ref as Record<string, unknown>).revision;
  } else if (operation === 'draft') {
    scope = `draft:${id}`; path = `/admin/experiences/${id}/draft`; method = 'PUT'; status = 200;
    payload = { expected_revision: 3, content: { legacy: true, revision: 17 } };
    response = { experience_id: id, draft_id: `draft_${id}`, revision: 4, content_hash: hash, content: { legacy: true, revision: 17 }, updated_by: 'admin', updated_at: timestamp };
    const { revision, ...rest } = response;
    expected = { ...rest, draft_revision: revision };
  } else {
    scope = `publish:${id}`; path = `/admin/experiences/${id}/releases`; method = 'POST'; status = 201;
    payload = { expected_revision: 4, content_hash: hash, validation_id: 'val_old', evaluation_id: 'eval_old', approval_refs: [] };
    const release = await insertExperienceRelease(db, { id: `rel_${key}`, experience_id: id, definition_version: '1', definition_hash: hash, definition_schema_version: '1.0', engine_version: '1', is_demo: true, approval_refs: [], validation_id: 'val_old', evaluation_id: 'eval_old', content: { legacy: true, revision: 17 }, published_by: 'admin' });
    expect(release.status).toBe('ok');
    response = { id: `rel_${key}`, experience_id: id, definition_version: '1', definition_hash: hash, definition_schema_version: '1.0', engine_version: '1', is_demo: true, approval_refs: [], published_at: release.status === 'ok' ? release.release.published_at.toISOString() : timestamp, published_by: 'admin' };
    expected = response;
  }
  const wirePayload = { ...payload };
  if (operation !== 'create') {
    wirePayload[operation === 'patch' ? 'expected_metadata_revision' : 'expected_draft_revision'] = wirePayload.expected_revision;
    delete wirePayload.expected_revision;
  }
  await saveIdempotencyRecord(db, { scope, key, request_hash: computeContentHash(fingerprint === 'baseline' ? payload : wirePayload), response_status: status, response_body: response });
  const snapshot = async () => ({
    metadata: await db.select().from(experiences).orderBy(experiences.id),
    draft: await db.select().from(experienceDrafts).orderBy(experienceDrafts.draft_id),
    releases: await db.select().from(experienceReleases).orderBy(experienceReleases.id),
    records: await db.select().from(idempotencyRecords).where(eq(idempotencyRecords.key, key)),
  });
  const before = await snapshot();
  const replay = await dispatch(call(method, path, admin, { ...wirePayload, idempotency_key: key }));
  expect(replay.status).toBe(status);
  expect((await json(replay)).data).toEqual(expected);
  expect(await snapshot()).toEqual(before);
  const changed = operation === 'create' || operation === 'patch' ? { name: 'Changed payload' }
    : operation === 'draft' ? { content: { changed: true } } : { validation_id: 'val_changed' };
  const collision = await dispatch(call(method, path, admin, { ...wirePayload, ...changed, idempotency_key: key }));
  expect(collision.status).toBe(409);
  expect(await snapshot()).toEqual(before);
  if (operation !== 'create') {
    const oldWire = await dispatch(call(method, path, admin, { ...payload, idempotency_key: key }));
    expect(oldWire.status).toBe(422);
  }
});

// Check the actual wire body against each operation's declared 409, not the broad ApiResponse.
it.each([
  { method: 'PATCH', file: 'public/experience-api.yaml', path: '/admin/experiences/{id}', revision: 'metadata' },
  { method: 'PUT', file: 'public/experience-api.yaml', path: '/admin/experiences/{id}/draft', revision: 'draft' },
  { method: 'POST', file: 'public/experience-release-api.yaml', path: '/admin/experiences/{id}/releases', revision: 'draft' },
])('$method stale $revision response satisfies its declared operation 409 schema', async ({ method, file, path, revision }) => {
  const { expId, hash } = await createWithValidDraft(`contract_${method.toLowerCase()}`);
  if (method === 'PATCH') {
    expect((await dispatch(call('PATCH', `/admin/experiences/${expId}`, admin, {
      expected_metadata_revision: 0, name: 'Contract updated name', idempotency_key: 'contract_patch_current',
    }))).status).toBe(200);
  }
  const body = method === 'PATCH'
    ? { expected_metadata_revision: 0, name: 'Stale metadata', idempotency_key: 'contract_patch_stale' }
    : method === 'PUT'
      ? { expected_draft_revision: 0, content: { title: 'Stale draft' }, idempotency_key: 'contract_put_stale' }
      : { expected_draft_revision: 0, content_hash: hash, validation_id: 'val_contract', evaluation_id: 'eval_contract', approval_refs: ['appr_contract'], idempotency_key: 'contract_post_stale' };
  const response = await dispatch(call(method, path.replace('{id}', expId), admin, body));
  expect(response.status).toBe(409);
  const envelope = await json(response);
  expect(envelope.error.code).toBe('CONFLICT_REVISION');
  expect(envelope.error.details).toMatchObject({ kind: 'revision_conflict', [`expected_${revision}_revision`]: 0, [`actual_${revision}_revision`]: 1 });
  const validate = declaredResponseValidator(file, path, method, 409);
  expect(validate(envelope), JSON.stringify(validate.errors)).toBe(true);
  const details = envelope.error.details;
  for (const field of [`expected_${revision}_revision`, `actual_${revision}_revision`]) {
    const missing = { ...details };
    delete missing[field];
    expect(validate({ ...envelope, error: { ...envelope.error, details: missing } })).toBe(false);
    expect(validate({ ...envelope, error: { ...envelope.error, details: { ...details, [field]: -1 } } })).toBe(false);
  }
  const other = revision === 'metadata' ? 'draft' : 'metadata';
  expect(validate({ ...envelope, error: { ...envelope.error, details: { ...details, [`actual_${other}_revision`]: 1 } } })).toBe(false);
  expect(validate({ ...envelope, error: { ...envelope.error, details: { kind: 'revision_conflict', expected_revision: 0, actual_revision: 1 } } })).toBe(false);
});
