import { describe, expect, it } from 'vitest';
import { GET as healthz } from './route';
import { GET as ready } from '../ready/route';

describe('public health routes', () => {
  it('uses the shared ok vocabulary for liveness', async () => {
    expect(await (await healthz()).json()).toEqual({ status: 'ok' });
  });

  it('exposes a dependency-neutral readiness shape', async () => {
    expect(await (await ready()).json()).toEqual({ status: 'ok', checks: { web: 'ok' } });
  });
});
