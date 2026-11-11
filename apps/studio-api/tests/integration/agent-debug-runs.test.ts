import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { closeProductDatabase, getProductDatabase } from '@/infrastructure/db/client';
import * as debugRuns from '@/modules/agent/debug-runs.repository';
import { dispatch } from '../helpers/api';
import { call, json } from '../helpers/users-api';
import { declaredResponseValidator } from '../helpers/openapi-response';
import { issueAccessToken } from '@/modules/auth/tokens';
import { seedAgent } from '@/modules/agent/agent.service';
import { computeContentHash } from '@/modules/experiences/canonical';
import { setAgentValidator } from '@/modules/agent/runtime-validation';
import { setRuntimeCaller } from '@/modules/agent/debug-runs';

let pg: PostgresHandle;
let admin: string;
const CHATFLOW_DRAFT = {
  greeting_text: 'Chào!', allowed_activity_profiles: [], mode: 'chatflow',
  workflow: {
    entry: 'start', nodes: [{ id: 'start', type: 'start' }, { id: 'reply', type: 'answer', config: { text: 'ok' } }],
    edges: [{ id: 'e1', source: 'start', source_handle: 'next', target: 'reply' }],
  },
};
beforeEach(async () => {
  vi.stubEnv('DATABASE_URL', pg.url);
  vi.stubEnv('SECRET_KEY', 'integration-test-secret');
  admin = await issueAccessToken('admin', true);
  setAgentValidator(async content => ({ valid: true, content_hash: computeContentHash(content), issues: [] }));
});
afterEach(() => { setAgentValidator(null); setRuntimeCaller(null); });
beforeAll(async () => {
  pg = await startPostgres();
  await migrateProduct(pg.url);
  vi.stubEnv('DATABASE_URL', pg.url);
  vi.stubEnv('SECRET_KEY', 'integration-test-secret');
  await seedAgent(getProductDatabase(), CHATFLOW_DRAFT);
});
afterAll(async () => { try { await closeProductDatabase(); } finally { await pg?.stop(); } });

const HASH = `sha256:${'a'.repeat(64)}`;
let counter = 0;
const row = (over: Partial<debugRuns.NewDebugRun> = {}): debugRuns.NewDebugRun => {
  counter += 1;
  const created = new Date();
  return {
    run_id: `dbg_${counter.toString(16).padStart(24, '0')}`, actor_id: 'admin-1', draft_revision: 1, content_hash: HASH,
    request: { message: 'x' }, result: { path: [] }, live_llm_calls: 0,
    created_at: created, expires_at: new Date(created.getTime() + 24 * 3600 * 1000), ...over,
  };
};

describe('debug run repository', () => {
  it('reads back a live run and hides an expired one', async () => {
    const db = getProductDatabase();
    const live = row();
    await debugRuns.insertDebugRun(db, live);
    expect((await debugRuns.findLiveDebugRun(db, live.run_id))?.result).toEqual({ path: [] });
    const old = row({ created_at: new Date(Date.now() - 48 * 3600 * 1000), expires_at: new Date(Date.now() - 24 * 3600 * 1000) });
    await debugRuns.insertDebugRun(db, old);
    expect(await debugRuns.findLiveDebugRun(db, old.run_id)).toBeUndefined();
  });

  it('deletes expired rows when it writes', async () => {
    const db = getProductDatabase();
    const old = row({ created_at: new Date(Date.now() - 48 * 3600 * 1000), expires_at: new Date(Date.now() - 24 * 3600 * 1000) });
    await debugRuns.insertDebugRun(db, old);
    await debugRuns.insertDebugRun(db, row());
    const found = await db.execute(sql`SELECT 1 FROM product.agent_debug_runs WHERE run_id = ${old.run_id}`);
    expect(found.rows).toHaveLength(0);
  });

  it('counts only this admin\'s runs of the last hour that really called a model', async () => {
    const db = getProductDatabase();
    const actor = 'counted-admin';
    await debugRuns.insertDebugRun(db, row({ actor_id: actor, live_llm_calls: 2 }));
    await debugRuns.insertDebugRun(db, row({ actor_id: actor, live_llm_calls: 0 }));
    await debugRuns.insertDebugRun(db, row({ actor_id: 'someone-else', live_llm_calls: 3 }));
    await debugRuns.insertDebugRun(db, row({ actor_id: actor, live_llm_calls: 1,
      created_at: new Date(Date.now() - 2 * 3600 * 1000), expires_at: new Date(Date.now() + 3600 * 1000) }));
    expect(await debugRuns.countLiveModelRuns(db, actor)).toBe(1);
  });
});

const expectDeclared = (envelope: unknown, path: string, method: string, status: number) => {
  const validate = declaredResponseValidator('public/agent-api.yaml', path, method, status);
  expect(validate(envelope), JSON.stringify(validate.errors)).toBe(true);
};
const RESULT = (over: Record<string, unknown> = {}) => {
  const created = new Date();
  return {
    run_id: `dbg_${'0123456789abcdef01234567'}`, status: 'completed', fallback_reason: null, path: ['start', 'reply'],
    node_runs: [], blocks: [], effects: [], llm_calls: 0, live_llm_calls: 0, tokens: { input: 0, output: 0 },
    created_at: created.toISOString(), expires_at: new Date(created.getTime() + 24 * 3600 * 1000).toISOString(), ...over,
  };
};
const okRuntime = (result: Record<string, unknown>) => async () =>
  new Response(JSON.stringify({ success: true, status: 200, data: result, error: null }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('POST /admin/agent/draft/debug-runs', () => {
  it('runs the draft, stores the result and lets it be read back', async () => {
    const result = RESULT({ run_id: 'dbg_aaaaaaaaaaaaaaaaaaaaaaaa' });
    let sent: { body: { request: unknown; content: { mode: string } }; accept: string } | undefined;
    setRuntimeCaller(async (body, accept) => { sent = { body: JSON.parse(body), accept }; return okRuntime(result)(); });
    const res = await dispatch(call('POST', '/admin/agent/draft/debug-runs', admin, { message: 'học phí MTU', state: { conv: { stage: 'welcome' } } }));
    expect(res.status).toBe(200);
    const created = await json(res);
    expect(created.data).toMatchObject({ run_id: result.run_id, path: ['start', 'reply'] });
    expectDeclared(created, '/admin/agent/draft/debug-runs', 'post', 200);
    expect(sent!.accept).toBe('application/json');
    expect(sent!.body.request).toEqual({ message: 'học phí MTU', state: { conv: { stage: 'welcome' } } });
    expect(sent!.body.content.mode).toBe('chatflow');
    const read = await dispatch(call('GET', `/admin/agent/debug-runs/${result.run_id}`, admin));
    expect(read.status).toBe(200);
    const readBody = await json(read);
    expect(readBody.data.run_id).toBe(result.run_id);
    expectDeclared(readBody, '/admin/agent/debug-runs/{run_id}', 'get', 200);
  });

  it('rejects a draft that does not validate with 422 VAL_INVALID_INPUT and the issues, without calling the runtime', async () => {
    setAgentValidator(async () => ({ valid: false, content_hash: 'h', issues: [{ path: 'workflow.nodes[1]', code: 'workflow_dead_end', message: 'x' }] }));
    const runtime = vi.fn();
    setRuntimeCaller(runtime);
    const res = await dispatch(call('POST', '/admin/agent/draft/debug-runs', admin, { message: 'a' }));
    expect(res.status).toBe(422);
    const body = await json(res);
    expect(body.error.code).toBe('VAL_INVALID_INPUT');
    expect(body.error.details.issues[0].path).toBe('workflow.nodes[1]');
    expect(runtime).not.toHaveBeenCalled();
  });

  it('asks the runtime to skip persona cases when it validates the draft', async () => {
    let options: unknown;
    setAgentValidator(async (content, _ctx, opts) => { options = opts; return { valid: true, content_hash: computeContentHash(content), issues: [] }; });
    setRuntimeCaller(okRuntime(RESULT({ run_id: 'dbg_bbbbbbbbbbbbbbbbbbbbbbbb' })));
    await dispatch(call('POST', '/admin/agent/draft/debug-runs', admin, { message: 'a' }));
    expect(options).toEqual({ personas: false });
  });

  it('answers 429 once the admin used 30 real-model runs in the hour, and stub-only runs do not count', async () => {
    const db = getProductDatabase();
    for (let i = 0; i < 29; i++) await debugRuns.insertDebugRun(db, row({ actor_id: 'admin', live_llm_calls: 1 }));
    for (let i = 0; i < 5; i++) await debugRuns.insertDebugRun(db, row({ actor_id: 'admin', live_llm_calls: 0 }));
    try {
      setRuntimeCaller(okRuntime(RESULT({ run_id: 'dbg_cccccccccccccccccccccccc', live_llm_calls: 1 })));
      expect((await dispatch(call('POST', '/admin/agent/draft/debug-runs', admin, { message: 'a' }))).status).toBe(200);
      const res = await dispatch(call('POST', '/admin/agent/draft/debug-runs', admin, { message: 'a' }));
      expect(res.status).toBe(429);
      expect((await json(res)).error.code).toBe('SYS_RATE_LIMITED');
    } finally {
      await db.execute(sql`DELETE FROM product.agent_debug_runs WHERE actor_id = 'admin'`);
    }
  });

  it('maps runtime failures: a refused request is 422, an unreachable runtime is a retryable 503', async () => {
    setRuntimeCaller(async () => new Response(JSON.stringify({ success: false, error: { code: 'INVALID_INPUT' } }), { status: 422 }));
    expect((await dispatch(call('POST', '/admin/agent/draft/debug-runs', admin, { message: 'a' }))).status).toBe(422);
    setRuntimeCaller(async () => new Response('{}', { status: 429 }));
    expect((await dispatch(call('POST', '/admin/agent/draft/debug-runs', admin, { message: 'a' }))).status).toBe(429);
    // The real client: a runtime that cannot be reached.
    setRuntimeCaller(null);
    vi.stubEnv('RUNTIME_INTERNAL_URL', 'http://runtime:8000');
    vi.stubEnv('STUDIO_RUNTIME_SIGNING_KEY', Buffer.alloc(32, 9).toString('base64'));
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    try {
      const res = await dispatch(call('POST', '/admin/agent/draft/debug-runs', admin, { message: 'a' }));
      expect(res.status).toBe(503);
      expect((await json(res)).error.retryable).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('validates the request body: exactly one of message or interaction', async () => {
    setRuntimeCaller(vi.fn());
    for (const bad of [{}, { message: 'a', interaction: { action: 'x' } }, { message: '' }, { nope: 1 }]) {
      expect((await dispatch(call('POST', '/admin/agent/draft/debug-runs', admin, bad))).status, JSON.stringify(bad)).toBe(422);
    }
  });

  it('is admin only', async () => {
    const user = await issueAccessToken('7', false);
    expect((await dispatch(call('POST', '/admin/agent/draft/debug-runs', user, { message: 'a' }))).status).toBe(403);
    expect((await dispatch(call('POST', '/admin/agent/draft/debug-runs', undefined, { message: 'a' }))).status).toBe(401);
    expect((await dispatch(call('GET', '/admin/agent/debug-runs/dbg_000000000000000000000000', user))).status).toBe(403);
  });
});

describe('GET /admin/agent/debug-runs/{run_id}', () => {
  it('is RES_NOT_FOUND for an unknown, malformed or expired run', async () => {
    const db = getProductDatabase();
    const old = row({ created_at: new Date(Date.now() - 49 * 3600 * 1000), expires_at: new Date(Date.now() - 25 * 3600 * 1000) });
    await debugRuns.insertDebugRun(db, old);
    for (const id of [old.run_id, 'dbg_ffffffffffffffffffffffff', 'nonsense']) {
      const res = await dispatch(call('GET', `/admin/agent/debug-runs/${id}`, admin));
      expect(res.status, id).toBe(404);
      const body = await json(res);
      expect(body.error.code).toBe('RES_NOT_FOUND');
      expectDeclared(body, '/admin/agent/debug-runs/{run_id}', 'get', 404);
    }
  });
});

describe('streamed debug runs', () => {
  const sse = (frames: string[]) => new Response(new ReadableStream({
    start(controller) { for (const frame of frames) controller.enqueue(new TextEncoder().encode(frame)); controller.close(); },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const request = (token: string) => new Request('http://localhost/api/v1/admin/agent/draft/debug-runs', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ message: 'a' }),
  });

  it('relays the frames unchanged and stores the result when the completed frame arrives', async () => {
    const result = RESULT({ run_id: 'dbg_dddddddddddddddddddddddd' });
    const frames = ['event: workflow.node_started\ndata: {"event":"workflow.node_started","node_id":"start","type":"start","order":1}\n\n',
      `event: completed\ndata: ${JSON.stringify({ event: 'completed', result })}\n\n`];
    setRuntimeCaller(async (_body, accept) => { expect(accept).toBe('text/event-stream'); return sse(frames); });
    const res = await dispatch(request(admin));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(await res.text()).toBe(frames.join(''));
    expect((await dispatch(call('GET', `/admin/agent/debug-runs/${result.run_id}`, admin))).status).toBe(200);
  });

  it('stores nothing when the stream ends without a completed frame', async () => {
    setRuntimeCaller(async () => sse(['event: error\ndata: {"event":"error","code":"INTERNAL_ERROR"}\n\n']));
    const res = await dispatch(request(admin));
    await res.text();
    expect((await dispatch(call('GET', '/admin/agent/debug-runs/dbg_eeeeeeeeeeeeeeeeeeeeeeee', admin))).status).toBe(404);
  });

  it('stores a run whose text contains U+2028 and U+2029', async () => {
    const result = RESULT({ run_id: 'dbg_888888888888888888888888', path: ['start', 'a\u2028b\u2029c'] });
    const frame = `event: completed\ndata: ${JSON.stringify({ event: 'completed', result })}\n\n`;
    setRuntimeCaller(async () => sse([frame]));
    await (await dispatch(request(admin))).text();
    const read = await dispatch(call('GET', `/admin/agent/debug-runs/${result.run_id}`, admin));
    expect(read.status).toBe(200);
    expect((await json(read)).data.path[1]).toBe('a\u2028b\u2029c');
  });

  it('copes with a completed frame split across chunks', async () => {
    const result = RESULT({ run_id: 'dbg_999999999999999999999999' });
    const frame = `event: completed\ndata: ${JSON.stringify({ event: 'completed', result })}\n\n`;
    setRuntimeCaller(async () => sse([frame.slice(0, 40), frame.slice(40)]));
    await (await dispatch(request(admin))).text();
    expect((await dispatch(call('GET', `/admin/agent/debug-runs/${result.run_id}`, admin))).status).toBe(200);
  });
});
