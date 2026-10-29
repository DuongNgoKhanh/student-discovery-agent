import { readFile } from 'node:fs/promises';
import { closeProductDatabase, getProductDatabase } from '@/infrastructure/db/client';
import { redact } from '@/infrastructure/db/migrate';
import { seedAgent } from '@/modules/agent/agent.service';

/** Usage: pnpm db:seed-agent <path/to/agent.json>. Needs DATABASE_URL; idempotent. */
async function main(): Promise<void> {
  const path = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!path || !url) {
    console.error('db:seed-agent: usage: DATABASE_URL=... pnpm db:seed-agent <agent.json>');
    process.exitCode = 1;
    return;
  }
  try {
    const content = JSON.parse(await readFile(path, 'utf8'));
    if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error('agent.json must be an object');
    console.log(`db:seed-agent: ${await seedAgent(getProductDatabase(), content)}`);
  } catch (error) {
    console.error(`db:seed-agent: failed: ${redact(error instanceof Error ? error.message : String(error), url)}`);
    process.exitCode = 1;
  } finally {
    await closeProductDatabase();
  }
}

void main();
