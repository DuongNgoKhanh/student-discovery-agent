import { Hono } from 'hono';
import { honoHandler, withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { registerAuthRoutes } from '@/modules/auth/auth.routes';
import { registerUsersRoutes } from '@/modules/users/users.routes';
import { registerVersionsRoutes } from '@/modules/versions/versions.routes';

export function createApp(): Hono {
  const app = new Hono();
  const health = withHandler(async (_req, ctx) => success({ status: 'alive' }, ctx));
  app.get('/api/health', honoHandler(health));
  registerAuthRoutes(app);
  registerUsersRoutes(app);
  registerVersionsRoutes(app);
  return app;
}
