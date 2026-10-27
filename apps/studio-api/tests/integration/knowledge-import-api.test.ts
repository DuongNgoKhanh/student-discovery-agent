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

async function kb() {
  const id = await createKb(admin);
  await createField(admin, id, { name: 'province', type: 'string', filterable: true });
  await createField(admin, id, { name: 'houses', type: 'string_list', filterable: true });
  return id;
}

const base = (kbId: string) => `/admin/knowledge-bases/${kbId}`;
const committable = (rows: Array<{ action: string; row: number; document_id: string; expected_revision: number; payload: unknown }>) =>
  rows.filter(r => r.action === 'create' || r.action === 'update')
    .map(({ row, document_id, expected_revision, payload }) => ({ row, document_id, expected_revision, payload }));

describe('knowledge import', () => {
  it('previews files: create, update keeping metadata, unchanged and invalid', async () => {
    const kbId = await kb();
    await api('PUT', `${base(kbId)}/documents/tuyen-sinh-ptit`, admin, {
      title: 'PTIT', body: 'cũ', source_url: 'https://ihrd.vn/ptit', metadata: { province: 'Hà Nội' }, expected_revision: 0,
    });
    await api('PUT', `${base(kbId)}/documents/tuyen-sinh-hiu`, admin, {
      title: 'HIU', body: '# HIU\n\nnội dung', source_url: null, metadata: {}, expected_revision: 0,
    });
    const preview = await api('POST', `${base(kbId)}/imports/preview`, admin, { kind: 'files', files: [
      { name: 'tuyen-sinh-hutech.md', content: '# HUTECH\n\nHọc phí' },
      { name: 'tuyen-sinh-ptit.md', content: '# PTIT\n\nmới' },
      { name: 'tuyen-sinh-hiu.md', content: '# HIU\n\nnội dung' },
      { name: 'scan.pdf', content: 'x' },
    ] });
    expect(preview.status).toBe(200);
    expectDeclared(preview.body, '/admin/knowledge-bases/{kb_id}/imports/preview', 'post', 200);
    const rows = preview.body.data.rows;
    expect(rows.map((r: { action: string }) => r.action)).toEqual(['create', 'update', 'unchanged', 'invalid']);
    expect(rows[1]).toMatchObject({
      document_id: 'tuyen-sinh-ptit', expected_revision: 1,
      payload: { title: 'PTIT', body: '# PTIT\n\nmới', source_url: 'https://ihrd.vn/ptit', metadata: { province: 'Hà Nội' } },
    });
  });

  it('previews CSV metadata updates that keep the body, and rejects bad rows', async () => {
    const kbId = await kb();
    await api('PUT', `${base(kbId)}/documents/hutech`, admin, {
      title: 'HUTECH', body: 'thân bài', source_url: null, metadata: { province: 'Cũ' }, expected_revision: 0,
    });
    const content = 'id,province,houses\nhutech,Hồ Chí Minh,E;C\nmissing-doc,Hà Nội,\nhutech,Trùng,\n';
    const preview = await api('POST', `${base(kbId)}/imports/preview`, admin, {
      kind: 'csv', content, mapping: { document_id: 'id', metadata: { province: 'province', houses: 'houses' } },
    });
    const rows = preview.body.data.rows;
    expect(rows[0]).toMatchObject({ action: 'update', payload: { body: 'thân bài', metadata: { province: 'Hồ Chí Minh', houses: ['E', 'C'] } } });
    expect(rows[1]).toMatchObject({ action: 'invalid' });
    expect(rows[2]).toMatchObject({ action: 'invalid' });

    const badColumn = await api('POST', `${base(kbId)}/imports/preview`, admin, {
      kind: 'csv', content, mapping: { document_id: 'nope', metadata: {} },
    });
    expect(badColumn.status).toBe(422);
  });

  it('commits row by row, reports conflicts after preview and replays by key', async () => {
    const kbId = await kb();
    await api('PUT', `${base(kbId)}/documents/b-doc`, admin, { title: 'B', body: 'v1', source_url: null, metadata: {}, expected_revision: 0 });
    const preview = await api('POST', `${base(kbId)}/imports/preview`, admin, { kind: 'files', files: [
      { name: 'a-doc.md', content: '# A\n\nmới' },
      { name: 'b-doc.md', content: '# B\n\nv2' },
    ] });
    await api('PUT', `${base(kbId)}/documents/b-doc`, admin, { title: 'B', body: 'sửa tay', source_url: null, metadata: {}, expected_revision: 1 });

    const rows = committable(preview.body.data.rows);
    const committed = await api('POST', `${base(kbId)}/imports`, admin, { idempotency_key: `imp-${kbId}`, rows });
    expect(committed.status).toBe(200);
    expectDeclared(committed.body, '/admin/knowledge-bases/{kb_id}/imports', 'post', 200);
    expect(committed.body.data).toMatchObject({ created: 1, updated: 0, conflict: 1, failed: 0 });
    expect(committed.body.data.rows.map((r: { outcome: string }) => r.outcome)).toEqual(['created', 'conflict']);

    const replay = await api('POST', `${base(kbId)}/imports`, admin, { idempotency_key: `imp-${kbId}`, rows });
    expect(replay.body.data).toEqual(committed.body.data);
    const [{ count }] = await adminSql(db, `SELECT count(*)::int AS count FROM knowledge.document_revisions WHERE document_id = 'a-doc'`);
    expect(count).toBe(1);

    const reused = await api('POST', `${base(kbId)}/imports`, admin, { idempotency_key: `imp-${kbId}`, rows: rows.slice(0, 1) });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('CONFLICT_IDEMPOTENCY_KEY');
  });

  it('keeps good rows when one row has invalid metadata', async () => {
    const kbId = await kb();
    const payload = (metadata: Record<string, unknown>) => ({ title: 'T', body: 'B', source_url: null, metadata });
    const committed = await api('POST', `${base(kbId)}/imports`, admin, { idempotency_key: `bad-${kbId}`, rows: [
      { row: 1, document_id: 'good', expected_revision: 0, payload: payload({ province: 'Huế' }) },
      { row: 2, document_id: 'bad', expected_revision: 0, payload: payload({ houses: 'E' }) },
    ] });
    expect(committed.body.data).toMatchObject({ created: 1, failed: 1 });
    expect(committed.body.data.rows[1]).toMatchObject({ document_id: 'bad', outcome: 'failed', revision: null });
    expect((await api('GET', `${base(kbId)}/documents/good`, admin)).status).toBe(200);
    expect((await api('GET', `${base(kbId)}/documents/bad`, admin)).status).toBe(404);
  });

  it('caps imports at 200 rows', async () => {
    const kbId = await kb();
    const files = Array.from({ length: 201 }, (_, i) => ({ name: `f${i}.md`, content: 'x' }));
    expect((await api('POST', `${base(kbId)}/imports/preview`, admin, { kind: 'files', files })).status).toBe(422);
  });
});
