import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { closeProductDatabase, getProductDatabase } from '@/infrastructure/db/client';
import * as repo from '@/modules/agent/agent.repository';

let pg: PostgresHandle;

beforeAll(async () => { pg = await startPostgres(); await migrateProduct(pg.url); });
afterAll(async () => { try { await closeProductDatabase(); } finally { await pg?.stop(); } });
beforeEach(async () => {
  vi.stubEnv('DATABASE_URL', pg.url);
  vi.stubEnv('SECRET_KEY', 'integration-test-secret');
  const db = getProductDatabase();
  await db.execute(sql`TRUNCATE product.agent_active, product.agent_draft, product.audit_events`);
  // agent_releases blocks TRUNCATE by design; tests start from a fresh container per file instead.
});

describe('agent repository', () => {
  it('saves the draft with optimistic revision and reports conflicts', async () => {
    const db = getProductDatabase();
    await repo.insertDraftIfMissing(db, { content: { greeting_text: 'a' }, hash: 'sha256:a', actor: 'admin' });
    const ok = await repo.saveDraft(db, { expectedRevision: 1, content: { greeting_text: 'b' }, hash: 'sha256:b', actor: 'admin' });
    expect(ok).toMatchObject({ status: 'ok', draft: { revision: 2, content_hash: 'sha256:b' } });
    const stale = await repo.saveDraft(db, { expectedRevision: 1, content: { greeting_text: 'c' }, hash: 'sha256:c', actor: 'admin' });
    expect(stale).toMatchObject({ status: 'conflict', current: { revision: 2 } });
  });

  it('keeps the revision when content is unchanged', async () => {
    const db = getProductDatabase();
    await repo.insertDraftIfMissing(db, { content: { x: 1 }, hash: 'sha256:x', actor: 'admin' });
    const same = await repo.saveDraft(db, { expectedRevision: 1, content: { x: 1 }, hash: 'sha256:x', actor: 'admin' });
    expect(same).toMatchObject({ status: 'ok', draft: { revision: 1 } });
  });

  it('numbers releases, moves the pointer with revision checks and rejects mutation', async () => {
    const db = getProductDatabase();
    const first = await db.transaction(async tx => {
      const release = await repo.insertRelease(tx, { content: { v: 1 }, hash: 'sha256:v1', draftRevision: 1, note: null, actor: 'admin' });
      expect(await repo.pointActive(tx, { releaseId: release.id, expectedRevision: null, actor: 'admin' })).not.toBeNull();
      return release;
    });
    const second = await db.transaction(tx =>
      repo.insertRelease(tx, { content: { v: 2 }, hash: 'sha256:v2', draftRevision: 2, note: 'n', actor: 'admin' }));
    expect(second.version).toBe(first.version + 1);
    await db.transaction(async tx => {
      expect(await repo.pointActive(tx, { releaseId: second.id, expectedRevision: 99, actor: 'admin' })).toBeNull();
      expect(await repo.pointActive(tx, { releaseId: second.id, expectedRevision: 1, actor: 'admin' })).toMatchObject({ revision: 2 });
    });
    expect((await repo.getActive(db))?.release.id).toBe(second.id);
    const mutation = await db.execute(sql`UPDATE product.agent_releases SET note = 'x'`).catch((e: unknown) => e);
    expect(String((mutation as { cause?: unknown }).cause)).toMatch(/immutable/);
  });

  it('pages releases and audit newest first', async () => {
    const db = getProductDatabase();
    await db.transaction(async tx => {
      for (const action of ['a', 'b', 'c']) {
        await repo.insertAudit(tx, { actor: 'admin', action: `agent.${action}`, target_kind: 'agent', target_id: 'default', before_ref: null, after_ref: null, outcome: 'success', details: {} });
      }
    });
    const page1 = await repo.listAudit(db, { limit: 2 });
    expect(page1.items.map(e => e.action)).toEqual(['agent.c', 'agent.b']);
    const page2 = await repo.listAudit(db, { limit: 2, cursor: page1.next_cursor! });
    expect(page2.items.map(e => e.action)).toEqual(['agent.a']);
    expect(page2.next_cursor).toBeNull();
  });
});
