import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeKnowledgePool } from '@/infrastructure/db/knowledge-client';
import { closeProductDatabase, getProductDatabase } from '@/infrastructure/db/client';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { issueAccessToken } from '@/modules/auth/tokens';
import { saveDraftContent, seedAgent } from '@/modules/agent/agent.service';
import { adminSql, startKnowledgePostgres, stubKnowledgeEnv, type KnowledgeDbHandle } from '../helpers/knowledge-db';
import { api, createKb, expectDeclared } from '../helpers/knowledge-api';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';

let db: KnowledgeDbHandle;
let pg: PostgresHandle;
let admin: string;
let user: string;
let usedByRelease: string;
let usedByDraft: string;

const agentWith = (kbId: string) => ({ tools: [{ name: 'knowledge.search', params: { knowledge_base_id: kbId, top_k: 4 } }] });
const stubEnv = () => {
  vi.unstubAllEnvs();
  stubKnowledgeEnv(db);
  vi.stubEnv('DATABASE_URL', pg.url);
};

beforeAll(async () => {
  db = await startKnowledgePostgres();
  pg = await startPostgres();
  await migrateProduct(pg.url);
  stubEnv();
  usedByRelease = 'kb-in-release';
  usedByDraft = 'kb-in-draft';
  await seedAgent(getProductDatabase(), agentWith(usedByRelease));
});
afterAll(async () => {
  try {
    await closeKnowledgePool();
    await closeProductDatabase();
  } finally {
    await db?.stop();
    await pg?.stop();
  }
});
beforeEach(async () => {
  stubEnv();
  admin = await issueAccessToken('admin', true);
  user = await issueAccessToken('123', false);
});

const put = (kb: string, doc: string) => api('PUT', `/admin/knowledge-bases/${kb}/documents/${doc}`, admin, {
  title: 'T', body: 'B', source_url: null, metadata: {}, expected_revision: 0,
});

describe('delete knowledge base', () => {
  it('requires an admin and 404s for a missing knowledge base', async () => {
    expect((await api('DELETE', '/admin/knowledge-bases/nope')).status).toBe(401);
    expect((await api('DELETE', '/admin/knowledge-bases/nope', user)).status).toBe(403);
    expect((await api('DELETE', '/admin/knowledge-bases/nope', admin)).status).toBe(404);
  });

  it('deletes with its documents, keeps the embedding cache and writes an audit row', async () => {
    const kbId = await createKb(admin);
    await put(kbId, 'doc-a');
    await adminSql(db, `INSERT INTO knowledge.embeddings (chunk_hash, embedding_model, embedding)
      VALUES ('sha256:${'c'.repeat(64)}', 'fake-embedding', '[1,2]') ON CONFLICT DO NOTHING`);
    const res = await api('DELETE', `/admin/knowledge-bases/${kbId}`, admin);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: kbId, deleted: true });
    expectDeclared(res.body, '/admin/knowledge-bases/{kb_id}', 'delete', 200);
    expect((await api('GET', `/admin/knowledge-bases/${kbId}`, admin)).status).toBe(404);
    expect(await adminSql(db, 'SELECT 1 FROM knowledge.documents WHERE kb_id = $1', [kbId])).toHaveLength(0);
    expect(await adminSql(db, 'SELECT 1 FROM knowledge.embeddings')).toHaveLength(1);
    const { rows } = await import('pg').then(async ({ Client }) => {
      const client = new Client({ connectionString: pg.url });
      await client.connect();
      try {
        return await client.query('SELECT actor, details FROM product.audit_events WHERE action = $1 AND target_id = $2', ['knowledge_base.delete', kbId]);
      } finally {
        await client.end();
      }
    });
    expect(rows).toEqual([{ actor: 'admin', details: { name: `KB ${kbId}`, document_count: 1 } }]);
  });

  it('answers 409 while the active release (seeded with a matching draft) uses it', async () => {
    await createKb(admin, { id: usedByRelease });
    const res = await api('DELETE', `/admin/knowledge-bases/${usedByRelease}`, admin);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'CONFLICT_RESOURCE_IN_USE', details: { kind: 'in_use', where: ['active_release', 'draft'] } });
    expect((await api('GET', `/admin/knowledge-bases/${usedByRelease}`, admin)).status).toBe(200);
  });

  it('answers 409 while the agent draft uses it', async () => {
    await createKb(admin, { id: usedByDraft });
    const draft = await getProductDatabase().query.agentDraft.findFirst();
    await saveDraftContent(getProductDatabase(), { content: agentWith(usedByDraft), expected_revision: draft!.revision }, 'admin');
    const res = await api('DELETE', `/admin/knowledge-bases/${usedByDraft}`, admin);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ kind: 'in_use', where: ['draft'] });
  });
});
