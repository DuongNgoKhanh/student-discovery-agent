import { and, eq, gt, gte, sql } from 'drizzle-orm';
import { agentDebugRuns } from '@/infrastructure/db/schema';
import type { ProductExecutor } from '@/modules/experiences/experiences.repository';

export type DebugRunRow = typeof agentDebugRuns.$inferSelect;
export type NewDebugRun = typeof agentDebugRuns.$inferInsert;

/** Expired rows are swept on every write, so there is no job to run. */
export async function insertDebugRun(db: ProductExecutor, row: NewDebugRun): Promise<void> {
  await db.delete(agentDebugRuns).where(sql`${agentDebugRuns.expires_at} < now()`);
  await db.insert(agentDebugRuns).values(row);
}

export async function findLiveDebugRun(db: ProductExecutor, runId: string): Promise<DebugRunRow | undefined> {
  const [row] = await db.select().from(agentDebugRuns)
    .where(and(eq(agentDebugRuns.run_id, runId), gt(agentDebugRuns.expires_at, sql`now()`))).limit(1);
  return row;
}

/** Runs of the last hour by this admin that called a real model: what the DEC-24 hourly allowance counts. */
export async function countLiveModelRuns(db: ProductExecutor, actorId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(agentDebugRuns)
    .where(and(eq(agentDebugRuns.actor_id, actorId), gt(agentDebugRuns.live_llm_calls, 0),
      gte(agentDebugRuns.created_at, sql`now() - interval '1 hour'`)));
  return row?.n ?? 0;
}
