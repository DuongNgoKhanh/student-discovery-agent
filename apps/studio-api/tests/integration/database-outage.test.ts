import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { migrateProduct } from '@/infrastructure/db/migrate';
import { startPostgres } from '../helpers/postgres';

it('keeps the Node process alive after an idle database connection is lost', async () => {
  const pg = await startPostgres();
  let child: ChildProcess | undefined;
  let stopped = false;
  try {
    await migrateProduct(pg.url);
    child = spawn(process.execPath, ['--import', 'tsx', 'tests/fixtures/outage-server.ts'], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      env: { ...process.env, DATABASE_URL: pg.url, SECRET_KEY: 'outage-test-only' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr!.on('data', (data) => { stderr += String(data); });
    const port = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('API startup timed out')), 10_000);
      child!.stdout!.on('data', (data) => {
        const match = /LISTENING:(\d+)/.exec(String(data));
        if (match?.[1]) { clearTimeout(timer); resolve(match[1]); }
      });
      child!.once('exit', () => { clearTimeout(timer); reject(new Error(stderr)); });
    });
    const origin = `http://127.0.0.1:${port}`;
    const registered = await fetch(`${origin}/api/v1/auth/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'outage@example.test', password: 'OutageTest1!' }),
    });
    expect(registered.status).toBe(200);
    await registered.json();
    const cookie = registered.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
    await pg.stop();
    stopped = true;
    expect(child.exitCode, stderr).toBeNull();
    const health = await fetch(`${origin}/api/health`);
    expect(health.status).toBe(200);
    const me = await fetch(`${origin}/api/v1/me`, { headers: { cookie }, signal: AbortSignal.timeout(5000) });
    expect(me.status).toBe(500);
    expect((await me.json()).success).toBe(false);
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    if (!stopped) await pg.stop();
  }
});
