import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPostgres, type PostgresHandle } from '../helpers/postgres';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { closeProductDatabase, getProductDatabase } from '@/infrastructure/db/client';
import * as debugRuns from '@/modules/agent/debug-runs.repository';

let pg: PostgresHandle;
beforeAll(async () => {
  pg = await startPostgres();
  await migrateProduct(pg.url);
  vi.stubEnv('DATABASE_URL', pg.url);
  vi.stubEnv('SECRET_KEY', 'integration-test-secret');
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
