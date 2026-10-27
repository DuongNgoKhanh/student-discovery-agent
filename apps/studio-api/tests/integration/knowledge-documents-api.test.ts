import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeKnowledgePool } from '@/infrastructure/db/knowledge-client';
import { issueAccessToken } from '@/modules/auth/tokens';
import { adminSql, startKnowledgePostgres, stubKnowledgeEnv, type KnowledgeDbHandle } from '../helpers/knowledge-db';
import { api, createField, createKb, expectDeclared } from '../helpers/knowledge-api';

let db: KnowledgeDbHandle;
let admin: string;

beforeAll(async () => { db = await startKnowledgePostgres(); });
afterAll(async () => {
  try { await closeKnowledgePool(); } finally { await db?.stop(); }
});
beforeEach(async () => {
  vi.unstubAllEnvs();
  stubKnowledgeEnv(db);
  admin = await issueAccessToken('admin', true);
});

async function kbWithFields() {
  const kb = await createKb(admin);
  await createField(admin, kb, { name: 'province', type: 'string', filterable: true });
  await createField(admin, kb, { name: 'houses', type: 'string_list', filterable: true });
  return kb;
}

const doc = (kb: string, id: string) => `/admin/knowledge-bases/${kb}/documents/${id}`;
const content = {
  title: 'HUTECH — Học phí', body: '# Học phí\n\n25 triệu/năm', source_url: 'https://ihrd.vn/hutech',
  metadata: { province: 'Hồ Chí Minh', houses: ['E', 'C'] },
};

describe('documents', () => {
  it('creates, edits, skips identical content and lists with index state', async () => {
    const kb = await kbWithFields();
    const created = await api('PUT', doc(kb, 'hutech'), admin, { ...content, expected_revision: 0 });
    expect(created.status).toBe(201);
    expectDeclared(created.body, '/admin/knowledge-bases/{kb_id}/documents/{document_id}', 'put', 201);
    expect(created.body.data).toEqual({ document_id: 'hutech', revision: 1, outcome: 'created' });

    const same = await api('PUT', doc(kb, 'hutech'), admin, { ...content, expected_revision: 1 });
    expect(same.status).toBe(200);
    expect(same.body.data).toEqual({ document_id: 'hutech', revision: 1, outcome: 'unchanged' });

    const edited = await api('PUT', doc(kb, 'hutech'), admin, { ...content, body: '# Học phí\n\n26 triệu/năm', expected_revision: 1 });
    expect(edited.body.data).toEqual({ document_id: 'hutech', revision: 2, outcome: 'updated' });

    const read = await api('GET', doc(kb, 'hutech'), admin);
    expectDeclared(read.body, '/admin/knowledge-bases/{kb_id}/documents/{document_id}', 'get', 200);
    expect(read.body.data).toMatchObject({
      id: 'hutech', kb_id: kb, status: 'active', revision: 2, active: null,
      latest: { revision: 2, title: content.title, source_url: content.source_url, metadata: content.metadata, index_status: 'pending', error: null },
    });

    const listed = await api('GET', `/admin/knowledge-bases/${kb}/documents?index_status=pending`, admin);
    expectDeclared(listed.body, '/admin/knowledge-bases/{kb_id}/documents', 'get', 200);
    expect(listed.body.data.items).toEqual([expect.objectContaining({ id: 'hutech', revision: 2, index_status: 'pending', active_revision: null })]);
  });

  it('stores metadata by field id and hashes like the Python writer', async () => {
    const kb = await kbWithFields();
    await api('PUT', doc(kb, 'ptit'), admin, { ...content, expected_revision: 0 });
    const [row] = await adminSql(db, `SELECT r.metadata, r.content_hash FROM knowledge.documents d
      JOIN knowledge.document_revisions r ON r.id = d.latest_revision_id WHERE d.id = 'ptit'`);
    expect(Object.keys(row.metadata).every((key: string) => key.startsWith('fld_'))).toBe(true);
    expect(row.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('rejects stale revisions, bad metadata and blank titles', async () => {
    const kb = await kbWithFields();
    await api('PUT', doc(kb, 'hiu'), admin, { ...content, expected_revision: 0 });
    const stale = await api('PUT', doc(kb, 'hiu'), admin, { ...content, body: 'x', expected_revision: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: 'CONFLICT_REVISION', details: { kind: 'revision_conflict', expected_revision: 0, actual_revision: 1 } });

    const metadata = await api('PUT', doc(kb, 'hiu'), admin, { ...content, metadata: { houses: 'E', unknown: 1 }, expected_revision: 1 });
    expect(metadata.status).toBe(422);
    expect(metadata.body.error.details.issues.map((i: { path: string }) => i.path).sort()).toEqual(['metadata.houses', 'metadata.unknown']);

    expect((await api('PUT', doc(kb, 'hiu'), admin, { ...content, title: '   ', expected_revision: 1 })).status).toBe(422);
    expect((await api('PUT', doc(kb, 'missing'), admin, { ...content, expected_revision: 3 })).status).toBe(404);
  });

  it('refuses a document id owned by another knowledge base', async () => {
    const first = await kbWithFields();
    const second = await kbWithFields();
    await api('PUT', doc(first, 'shared-id'), admin, { ...content, expected_revision: 0 });
    const res = await api('PUT', doc(second, 'shared-id'), admin, { ...content, expected_revision: 0 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT_ALREADY_EXISTS');
  });

  it('archives and restores with expected_revision', async () => {
    const kb = await kbWithFields();
    await api('PUT', doc(kb, 'ufm'), admin, { ...content, expected_revision: 0 });
    expect((await api('POST', `${doc(kb, 'ufm')}/archive`, admin, { expected_revision: 2 })).status).toBe(409);
    const archived = await api('POST', `${doc(kb, 'ufm')}/archive`, admin, { expected_revision: 1 });
    expect(archived.status).toBe(200);
    expectDeclared(archived.body, '/admin/knowledge-bases/{kb_id}/documents/{document_id}/archive', 'post', 200);
    expect(archived.body.data.status).toBe('archived');
    expect((await api('POST', `${doc(kb, 'ufm')}/archive`, admin, { expected_revision: 1 })).body.data.status).toBe('archived');
    expect((await api('POST', `${doc(kb, 'ufm')}/restore`, admin, { expected_revision: 1 })).body.data.status).toBe('active');
  });

  it('retries only a failed revision', async () => {
    const kb = await kbWithFields();
    await api('PUT', doc(kb, 'mtu'), admin, { ...content, expected_revision: 0 });
    const notFailed = await api('POST', `${doc(kb, 'mtu')}/revisions/1/retry`, admin);
    expect(notFailed.status).toBe(409);
    expect(notFailed.body.error.code).toBe('CONFLICT_INVALID_STATE');
    await adminSql(db, `UPDATE knowledge.document_revisions SET index_status = 'error', error = 'embedding quota'
      WHERE document_id = 'mtu' AND revision = 1`);
    expect((await api('GET', doc(kb, 'mtu'), admin)).body.data.latest).toMatchObject({ index_status: 'error', error: 'embedding quota' });
    const retried = await api('POST', `${doc(kb, 'mtu')}/revisions/1/retry`, admin);
    expect(retried.status).toBe(200);
    expect(retried.body.data.latest).toMatchObject({ index_status: 'pending', error: null });
    expect((await api('POST', `${doc(kb, 'mtu')}/revisions/9/retry`, admin)).status).toBe(404);
  });

  it('pages documents by id', async () => {
    const kb = await kbWithFields();
    for (const id of ['a-doc', 'b-doc', 'c-doc']) await api('PUT', doc(kb, id), admin, { ...content, expected_revision: 0 });
    const first = await api('GET', `/admin/knowledge-bases/${kb}/documents?limit=2`, admin);
    expect(first.body.data.items.map((d: { id: string }) => d.id)).toEqual(['a-doc', 'b-doc']);
    const cursor = first.body.meta.pagination.next_cursor;
    const second = await api('GET', `/admin/knowledge-bases/${kb}/documents?limit=2&cursor=${encodeURIComponent(cursor)}`, admin);
    expect(second.body.data.items.map((d: { id: string }) => d.id)).toEqual(['c-doc']);
    expect(second.body.meta.pagination.has_more).toBe(false);
  });
});
