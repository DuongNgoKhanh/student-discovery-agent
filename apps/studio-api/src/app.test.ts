import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('standalone API liveness', () => {
  it('responds without Product credentials or infrastructure', async () => {
    const response = await createApp().request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { status: 'alive' } });
  });
});
