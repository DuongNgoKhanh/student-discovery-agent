import { Hono } from 'hono';
import { withHandler } from '@/http/handler';
import { success } from '@/http/response';

export function createApp(): Hono {
  const app = new Hono();
  const health = withHandler(async (_req, ctx) => success({ status: 'alive' }, ctx));
  app.get('/api/health', (c) => health(c.req.raw, { params: Promise.resolve({}) }));
  return app;
}
