import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('standalone API liveness', () => {
  it('responds without Product credentials or infrastructure', async () => {
    const response = await createApp().request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { status: 'ok' } });
  });

  it('returns a public readiness summary with 200 when every check is ok', async () => {
    const app = createApp({ readiness: async () => ({
      status: 'ok', checks: { db: 'ok', minio: 'ok', runtime: 'ok' },
    }) });
    const response = await app.request('/api/ready');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok', checks: { db: 'ok', minio: 'ok', runtime: 'ok' },
    });
  });

  it('returns 503 with degraded readiness without exposing dependency details', async () => {
    const app = createApp({ readiness: async () => ({
      status: 'degraded', checks: { db: 'down', minio: 'ok', runtime: 'degraded' },
    }) });
    const response = await app.request('/api/ready');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: 'degraded', checks: { db: 'down', minio: 'ok', runtime: 'degraded' },
    });
  });
});
