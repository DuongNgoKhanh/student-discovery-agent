import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { jwtVerify } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeKnowledgePool } from '@/infrastructure/db/knowledge-client';
import { issueAccessToken } from '@/modules/auth/tokens';
import { startKnowledgePostgres, stubKnowledgeEnv, type KnowledgeDbHandle } from '../helpers/knowledge-db';
import { api, createField, createKb, expectDeclared } from '../helpers/knowledge-api';

const KEY = Buffer.from('studio-test-key-at-least-32-bytes!!');
let db: KnowledgeDbHandle;
let runtime: Server;
let runtimeUrl: string;
let admin: string;
let reply: { status: number; body: unknown };
const seen: Array<{ url: string; headers: IncomingMessage['headers']; body: string }> = [];

beforeAll(async () => {
  db = await startKnowledgePostgres();
  runtime = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      seen.push({ url: req.url ?? '', headers: req.headers, body });
      res.writeHead(reply.status, { 'content-type': 'application/json' }).end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>(resolve => runtime.listen(0, '127.0.0.1', resolve));
  runtimeUrl = `http://127.0.0.1:${(runtime.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise(resolve => runtime?.close(resolve));
  try { await closeKnowledgePool(); } finally { await db?.stop(); }
});

beforeEach(async () => {
  vi.unstubAllEnvs();
  stubKnowledgeEnv(db, {
    RUNTIME_INTERNAL_URL: runtimeUrl, STUDIO_RUNTIME_SIGNING_KEY: KEY.toString('base64'), STUDIO_RUNTIME_SIGNING_KID: 'studio',
  });
  admin = await issueAccessToken('admin', true);
  seen.length = 0;
  reply = { status: 200, body: { success: true, data: { records: [
    { content: 'Học phí 25 triệu', score: 0.82, title: 'HUTECH', metadata: { document_id: 'hutech', revision: 2 } },
  ], degraded: false } } };
});

describe('test search', () => {
  it('signs a studio service request and returns the runtime records', async () => {
    const kbId = await createKb(admin);
    const res = await api('POST', `/admin/knowledge-bases/${kbId}/search`, admin, { query: 'học phí', top_k: 3 });
    expect(res.status).toBe(200);
    expectDeclared(res.body, '/admin/knowledge-bases/{kb_id}/search', 'post', 200);
    expect(res.body.data.records[0]).toMatchObject({ title: 'HUTECH', score: 0.82 });

    const [call] = seen;
    expect(call!.url).toBe('/api/v1/internal/knowledge/retrieval');
    expect(JSON.parse(call!.body)).toEqual({ knowledge_id: kbId, query: 'học phí', retrieval_setting: { top_k: 3 } });
    expect(call!.headers['x-internal-caller']).toBe('sda-studio-api');
    const { payload } = await jwtVerify(String(call!.headers['x-caller-context']), new Uint8Array(KEY), {
      issuer: 'sda-studio-api', audience: 'sda-agent-runtime',
    });
    expect(payload).toMatchObject({ caller_type: 'studio_service', purpose: 'knowledge.retrieval', request_target: '/api/v1/internal/knowledge/retrieval' });
  });

  it('maps runtime errors and missing configuration', async () => {
    const kbId = await createKb(admin);
    reply = { status: 404, body: { success: false, error: { code: 'RES_NOT_FOUND' } } };
    expect((await api('POST', `/admin/knowledge-bases/${kbId}/search`, admin, { query: 'x' })).status).toBe(404);
    reply = { status: 503, body: { success: false } };
    const down = await api('POST', `/admin/knowledge-bases/${kbId}/search`, admin, { query: 'x' });
    expect(down.status).toBe(503);
    expect(down.body.error.code).toBe('SYS_UNAVAILABLE');
    vi.stubEnv('STUDIO_RUNTIME_SIGNING_KEY', '');
    expect((await api('POST', `/admin/knowledge-bases/${kbId}/search`, admin, { query: 'x' })).status).toBe(503);
    expect((await api('POST', `/admin/knowledge-bases/${kbId}/search`, admin, { query: '' })).status).toBe(422);
  });
});

describe('agent params', () => {
  it('derives knowledge.search and knowledge.show params from the fields', async () => {
    const kbId = await createKb(admin);
    await createField(admin, kbId, { name: 'major', type: 'string', label: 'Ngành', filterable: true, ordinal: 1 });
    await createField(admin, kbId, { name: 'tuition_text', type: 'string', label: 'Học phí', ordinal: 2 });
    await createField(admin, kbId, { name: 'houses', type: 'string_list', filterable: true, ordinal: 3 });
    const res = await api('GET', `/admin/knowledge-bases/${kbId}/agent-params`, admin);
    expectDeclared(res.body, '/admin/knowledge-bases/{kb_id}/agent-params', 'get', 200);
    expect(res.body.data).toEqual({
      'knowledge.search': { knowledge_base_id: kbId, top_k: 4, auto_filter_fields: ['major', 'houses'] },
      'knowledge.show': { display: [
        { field: 'major', label: 'Ngành' }, { field: 'tuition_text', label: 'Học phí' }, { field: 'houses', label: 'houses' },
      ] },
    });
  });
});
