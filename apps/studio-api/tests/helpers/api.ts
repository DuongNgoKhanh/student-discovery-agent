import { createApp } from '@/app';

const app = createApp();

/** Exercise registered HTTP routes, not individual controller exports. */
export async function dispatch(request: Request): Promise<Response> {
  return app.request(request);
}
