import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from '../helpers/api';
import { declaredResponseValidator } from '../helpers/openapi-response';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { call, json, validateEnvelope } from '../helpers/users-api';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { closeProductDatabase, getProductDatabase } from '@/infrastructure/db/client';
import { issueAccessToken } from '@/modules/auth/tokens';
import { seedAgent } from '@/modules/agent/agent.service';
import { computeContentHash } from '@/modules/experiences/canonical';
import { setAgentValidator } from '@/modules/agent/runtime-validation';

export const SEED = { greeting_text: 'Chào bạn!', allowed_activity_profiles: ['riasec.mean.bounds.v2'] };
const expectDeclared = (envelope: unknown, path: string, method: string, status: number) => {
  const validate = declaredResponseValidator('public/agent-api.yaml', path, method, status);
  expect(validate(envelope), JSON.stringify(validate.errors)).toBe(true);
};
let pg: PostgresHandle;
let admin: string;

beforeAll(async () => {
  pg = await startPostgres();
  await migrateProduct(pg.url);
  vi.stubEnv('DATABASE_URL', pg.url);
  vi.stubEnv('SECRET_KEY', 'integration-test-secret');
  await seedAgent(getProductDatabase(), SEED);
});
afterAll(async () => { try { await closeProductDatabase(); } finally { await pg?.stop(); } });
beforeEach(async () => {
  vi.stubEnv('DATABASE_URL', pg.url);
  vi.stubEnv('SECRET_KEY', 'integration-test-secret');
  admin = await issueAccessToken('admin', true);
});

const req = async (method: string, path: string, body?: unknown, token = admin) => {
  const res = await dispatch(call(method, path, token, body));
  const envelope = await json(res);
  expect(validateEnvelope(envelope)).toBe(true);
  return { status: res.status, body: envelope };
};

describe('agent draft API', () => {
  it('requires admin', async () => {
    const user = await issueAccessToken('7', false);
    expect((await req('GET', '/admin/agent/draft', undefined, user)).status).toBe(403);
  });

  it('reads the seeded draft and saves with revision', async () => {
    const read = await req('GET', '/admin/agent/draft');
    expect(read.body.data).toMatchObject({ content: SEED, revision: 1 });
    expectDeclared(read.body, '/admin/agent/draft', 'get', 200);
    const saved = await req('PUT', '/admin/agent/draft', { content: { ...SEED, greeting_text: 'Xin chào' }, expected_revision: 1 });
    expect(saved.body.data.revision).toBe(2);
    const stale = await req('PUT', '/admin/agent/draft', { content: SEED, expected_revision: 1 });
    expect(stale.status).toBe(409);
    expectDeclared(stale.body, '/admin/agent/draft', 'put', 409);
    expect(stale.body.error).toMatchObject({ code: 'CONFLICT_REVISION', details: { current: { revision: 2 } } });
  });

  it('rejects non-object content', async () => {
    expect((await req('PUT', '/admin/agent/draft', { content: [], expected_revision: 2 })).status).toBe(422);
  });
});

describe('agent draft validations', () => {
  afterAll(() => setAgentValidator(null));

  it('returns the runtime report bound to the draft revision', async () => {
    setAgentValidator(async () => ({ valid: false, content_hash: 'sha256:x', issues: [{ path: 'greeting_text', code: 'missing', message: 'Thiếu' }] }));
    const res = await req('POST', '/admin/agent/draft/validations');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ valid: false, issues: [{ path: 'greeting_text' }] });
    expect(typeof res.body.data.draft_revision).toBe('number');
  });
});

describe('agent releases', () => {
  beforeEach(() => setAgentValidator(async content => ({ valid: true, content_hash: computeContentHash(content), issues: [] })));
  afterAll(() => setAgentValidator(null));

  const state = async () => ({
    draft: (await req('GET', '/admin/agent/draft')).body.data,
    active: (await req('GET', '/admin/agent/active')).body.data,
  });

  it('publishes v2, lists it as active and restores v1', async () => {
    const before = await state();
    await req('PUT', '/admin/agent/draft', { content: { ...SEED, greeting_text: 'Bản mới' }, expected_revision: before.draft.revision });
    const after = await state();
    const published = await req('POST', '/admin/agent/releases', {
      expected_draft_revision: after.draft.revision, expected_active_revision: after.active.revision, note: 'đổi lời chào', idempotency_key: 'publish-it-0001',
    });
    expect(published.status).toBe(201);
    expectDeclared(published.body, '/admin/agent/releases', 'post', 201);
    expect(published.body.data).toMatchObject({ is_active: true, note: 'đổi lời chào' });

    const list = await req('GET', '/admin/agent/releases?limit=10');
    expectDeclared(list.body, '/admin/agent/releases', 'get', 200);
    expect(list.body.data.items[0]).toMatchObject({ id: published.body.data.id, is_active: true });
    const v1 = list.body.data.items.find((r: { version: number }) => r.version === 1);

    const active = (await state()).active;
    const restored = await req('POST', `/admin/agent/releases/${v1.id}:restore`, { expected_active_revision: active.revision, idempotency_key: 'restore-it-0001' });
    expect(restored.body.data).toMatchObject({ release_id: v1.id, version: 1 });
    expectDeclared(restored.body, '/admin/agent/releases/{release_id}:restore', 'post', 200);
    expectDeclared((await req('GET', '/admin/agent/active')).body, '/admin/agent/active', 'get', 200);

    const audit = await req('GET', '/admin/agent/audit-logs');
    expectDeclared(audit.body, '/admin/agent/audit-logs', 'get', 200);
    expect(audit.body.data.items.map((e: { action: string }) => e.action).slice(0, 2)).toEqual(['agent.release.restore', 'agent.release.publish']);
  });

  it('replays the same idempotency key and rejects a different payload', async () => {
    const { draft, active } = await state();
    await req('PUT', '/admin/agent/draft', { content: { ...SEED, greeting_text: `x${Date.now()}` }, expected_revision: draft.revision });
    const fresh = (await state()).draft;
    const body = { expected_draft_revision: fresh.revision, expected_active_revision: active.revision, idempotency_key: 'publish-it-0002' };
    const first = await req('POST', '/admin/agent/releases', body);
    const again = await req('POST', '/admin/agent/releases', body);
    expect(again.body.data.id).toBe(first.body.data.id);
    const clash = await req('POST', '/admin/agent/releases', { ...body, note: 'khác' });
    expect(clash.body.error.code).toBe('CONFLICT_IDEMPOTENCY_KEY');
  });

  it('allows only one of two concurrent publishes', async () => {
    const { draft, active } = await state();
    await req('PUT', '/admin/agent/draft', { content: { ...SEED, greeting_text: `y${Date.now()}` }, expected_revision: draft.revision });
    const fresh = (await state()).draft;
    const body = (key: string) => ({ expected_draft_revision: fresh.revision, expected_active_revision: active.revision, idempotency_key: key });
    const results = await Promise.all([req('POST', '/admin/agent/releases', body('publish-it-0003')), req('POST', '/admin/agent/releases', body('publish-it-0004'))]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
  });

  it('rejects publishing when validation fails', async () => {
    setAgentValidator(async () => ({ valid: false, content_hash: 'h', issues: [{ path: 'model.ref', code: 'value_error', message: 'x' }] }));
    const { draft, active } = await state();
    const res = await req('POST', '/admin/agent/releases', { expected_draft_revision: draft.revision, expected_active_revision: active.revision, idempotency_key: 'publish-it-0005' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.issues[0].path).toBe('model.ref');
    expectDeclared(res.body, '/admin/agent/releases', 'post', 422);
  });

  it('replays a publish after the draft changed without creating a release', async () => {
    const { draft, active } = await state();
    await req('PUT', '/admin/agent/draft', { content: { ...SEED, greeting_text: `r${Date.now()}` }, expected_revision: draft.revision });
    const fresh = (await state()).draft;
    const body = { expected_draft_revision: fresh.revision, expected_active_revision: active.revision, idempotency_key: 'publish-it-0006' };
    const first = await req('POST', '/admin/agent/releases', body);
    expect(first.status).toBe(201);
    const count = (await req('GET', '/admin/agent/releases?limit=100')).body.data.items.length;
    await req('PUT', '/admin/agent/draft', { content: { ...SEED, greeting_text: `s${Date.now()}` }, expected_revision: fresh.revision });
    const again = await req('POST', '/admin/agent/releases', body);
    expect(again.status).toBe(201);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect((await req('GET', '/admin/agent/releases?limit=100')).body.data.items.length).toBe(count);
  });

  it('409s when restoring the already-active release and when a restore key is reused for another release', async () => {
    const { active } = await state();
    const items = (await req('GET', '/admin/agent/releases?limit=100')).body.data.items;
    const other = items.find((r: { id: string }) => r.id !== active.release_id);
    const same = await req('POST', `/admin/agent/releases/${active.release_id}:restore`, { expected_active_revision: active.revision, idempotency_key: 'restore-it-0002' });
    expect(same.status).toBe(409);
    expect(same.body.error.details.kind).toBe('no_changes');
    const done = await req('POST', `/admin/agent/releases/${other.id}:restore`, { expected_active_revision: active.revision, idempotency_key: 'restore-it-0003' });
    expect(done.status).toBe(200);
    const clash = await req('POST', `/admin/agent/releases/${active.release_id}:restore`, { expected_active_revision: active.revision, idempotency_key: 'restore-it-0003' });
    expect(clash.body.error.code).toBe('CONFLICT_IDEMPOTENCY_KEY');
  });
});

const DELIVERY_KEY = Buffer.alloc(32, 4);
async function runtimeToken(target: string) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ caller_type: 'runtime_service', purpose: 'release.delivery', method: 'GET', request_target: target,
    body_sha256: createHash('sha256').update('').digest('hex') })
    .setProtectedHeader({ alg: 'HS256', typ: 'sda-internal+jwt', kid: 'runtime' })
    .setIssuer('sda-agent-runtime').setAudience('sda-studio-api').setIssuedAt(now).setExpirationTime(now + 60)
    .sign(new Uint8Array(DELIVERY_KEY));
}

describe('internal release delivery', () => {
  beforeEach(() => vi.stubEnv('PRODUCT_DELIVERY_VERIFY_KEY', DELIVERY_KEY.toString('base64')));

  it('returns the active agent as a ReleaseDescriptor', async () => {
    const target = '/api/v1/internal/releases/active?kind=agent&environment=demo';
    const res = await dispatch(new Request(`http://localhost${target}`, {
      headers: { 'x-internal-caller': 'sda-agent-runtime', 'x-caller-context': await runtimeToken(target) } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ environment: 'demo', kind: 'agent', delivery_schema_version: 'agent.snapshot.v1', is_demo: true });
    expect(body.data.content_hash).toBe(computeContentHash(body.data.content));
  });

  it('rejects an admin bearer token', async () => {
    const res = await dispatch(call('GET', '/internal/releases/active?kind=agent&environment=demo', admin));
    expect(res.status).toBe(401);
  });
});
