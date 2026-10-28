import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeKnowledgePool } from '@/infrastructure/db/knowledge-client';
import { issueAccessToken } from '@/modules/auth/tokens';
import { adminSql, startKnowledgePostgres, stubKnowledgeEnv, type KnowledgeDbHandle } from '../helpers/knowledge-db';
import { api, createField, createKb, expectDeclared, newKbId } from '../helpers/knowledge-api';

let db: KnowledgeDbHandle;
let admin: string;
let user: string;

beforeAll(async () => {
  db = await startKnowledgePostgres();
});

afterAll(async () => {
  try {
    await closeKnowledgePool();
  } finally {
    await db?.stop();
  }
});

beforeEach(async () => {
  vi.unstubAllEnvs();
  stubKnowledgeEnv(db);
  admin = await issueAccessToken('admin', true);
  user = await issueAccessToken('123', false);
});

describe('knowledge bases', () => {
  it('requires an admin', async () => {
    expect((await api('GET', '/admin/knowledge-bases')).status).toBe(401);
    expect((await api('GET', '/admin/knowledge-bases', user)).status).toBe(403);
  });

  it('creates, reads, lists and renames a knowledge base', async () => {
    const id = newKbId();
    const created = await api('POST', '/admin/knowledge-bases', admin, {
      id, name: 'Tuyển sinh', description: 'Dữ liệu IHRD', embedding_model: 'fake-embedding',
    });
    expect(created.status).toBe(201);
    expectDeclared(created.body, '/admin/knowledge-bases', 'post', 201);
    expect(created.body.data).toMatchObject({ id, name: 'Tuyển sinh', document_count: 0, error_count: 0 });

    const listed = await api('GET', '/admin/knowledge-bases', admin);
    expectDeclared(listed.body, '/admin/knowledge-bases', 'get', 200);
    expect(listed.body.data.items.map((kb: { id: string }) => kb.id)).toContain(id);

    const patched = await api('PATCH', `/admin/knowledge-bases/${id}`, admin, { name: 'Tuyển sinh 2026' });
    expect(patched.status).toBe(200);
    expectDeclared(patched.body, '/admin/knowledge-bases/{kb_id}', 'patch', 200);
    expect(patched.body.data.name).toBe('Tuyển sinh 2026');
  });

  it('derives the id from the name', async () => {
    const name = `Trường Đại học ${newKbId()}`;
    const created = await api('POST', '/admin/knowledge-bases', admin, { name, embedding_model: 'fake-embedding' });
    expect(created.body.data.id).toMatch(/^truong-dai-hoc-kb-/);
  });

  it('rejects duplicate ids, unknown models and model changes', async () => {
    const id = await createKb(admin);
    const duplicate = await api('POST', '/admin/knowledge-bases', admin, { id, name: 'x', embedding_model: 'fake-embedding' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT_ALREADY_EXISTS');
    const model = await api('POST', '/admin/knowledge-bases', admin, { name: 'x', embedding_model: 'other-model' });
    expect(model.status).toBe(422);
    const change = await api('PATCH', `/admin/knowledge-bases/${id}`, admin, { embedding_model: 'gemini-embedding-2' });
    expect(change.status).toBe(422);
    expect((await api('GET', '/admin/knowledge-bases/missing-kb', admin)).status).toBe(404);
  });

  it('answers 503 when knowledge storage is not configured', async () => {
    vi.stubEnv('KNOWLEDGE_DATABASE_URL', '');
    const res = await api('GET', '/admin/knowledge-bases', admin);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SYS_UNAVAILABLE');
  });
});

describe('metadata fields', () => {
  it('creates fields in ordinal order and edits only label, filterable and ordinal', async () => {
    const kb = await createKb(admin);
    await createField(admin, kb, { name: 'province', type: 'string', label: 'Tỉnh', filterable: true, ordinal: 2 });
    const houses = await createField(admin, kb, { name: 'houses', type: 'string_list', ordinal: 1 });
    expect(houses).toMatchObject({ name: 'houses', type: 'string_list', label: '', filterable: false, ordinal: 1 });

    const listed = await api('GET', `/admin/knowledge-bases/${kb}/fields`, admin);
    expectDeclared(listed.body, '/admin/knowledge-bases/{kb_id}/fields', 'get', 200);
    expect(listed.body.data.items.map((f: { name: string }) => f.name)).toEqual(['houses', 'province']);

    const patched = await api('PATCH', `/admin/knowledge-bases/${kb}/fields/houses`, admin, {
      label: 'Hệ', filterable: true, name: 'houses', type: 'string_list',
    });
    expect(patched.status).toBe(200);
    expectDeclared(patched.body, '/admin/knowledge-bases/{kb_id}/fields/{field_name}', 'patch', 200);
    expect(patched.body.data).toMatchObject({ label: 'Hệ', filterable: true });

    for (const body of [{ type: 'string' }, { name: 'house_list' }]) {
      const res = await api('PATCH', `/admin/knowledge-bases/${kb}/fields/houses`, admin, body);
      expect(res.status).toBe(422);
    }
    const duplicate = await api('POST', `/admin/knowledge-bases/${kb}/fields`, admin, { name: 'houses', type: 'string' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT_ALREADY_EXISTS');
  });

  it('deletes an unused field but refuses one that active documents still use', async () => {
    const kb = await createKb(admin);
    const unused = await createField(admin, kb, { name: 'note', type: 'string' });
    const used = await createField(admin, kb, { name: 'province', type: 'string' });
    await adminSql(db, `INSERT INTO knowledge.documents (id, kb_id) VALUES ('d-${kb}', $1)`, [kb]);
    await adminSql(db, `INSERT INTO knowledge.document_revisions (id, document_id, revision, title, body, metadata, content_hash)
      VALUES ('r-${kb}', 'd-${kb}', 1, 'T', 'B', $1, $2)`, [JSON.stringify({ [used.id]: 'Hà Nội' }), `sha256:${'c'.repeat(64)}`]);
    await adminSql(db, `UPDATE knowledge.documents SET revision = 1, latest_revision_id = 'r-${kb}' WHERE id = 'd-${kb}'`);

    const removed = await api('DELETE', `/admin/knowledge-bases/${kb}/fields/${unused.name}`, admin);
    expect(removed.status).toBe(200);
    expectDeclared(removed.body, '/admin/knowledge-bases/{kb_id}/fields/{field_name}', 'delete', 200);

    const refused = await api('DELETE', `/admin/knowledge-bases/${kb}/fields/province`, admin);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'CONFLICT_RESOURCE_IN_USE', details: { kind: 'field_in_use', documents: 1 } });

    await adminSql(db, `UPDATE knowledge.documents SET status = 'archived' WHERE id = 'd-${kb}'`);
    expect((await api('DELETE', `/admin/knowledge-bases/${kb}/fields/province`, admin)).status).toBe(200);
  });
});
