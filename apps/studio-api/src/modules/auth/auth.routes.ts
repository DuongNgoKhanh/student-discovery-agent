import { getConnInfo } from '@hono/node-server/conninfo';
import { setTrustedPeer } from './registration-limit';
import type { Hono } from 'hono';
import { honoHandler } from '@/http/handler';
import { handlePost as LoginPost } from './routes/login';
import { handlePost as RegisterPost } from './routes/register';
import { handlePost as RefreshPost } from './routes/refresh';
import { handlePost as LogoutPost } from './routes/logout';
import { handlePost as AdminLoginPost } from './routes/admin-login';
import { handleGet as sessionGet } from './routes/session';

export function registerAuthRoutes(app: Hono): void {
  app.get('/api/v1/auth/session', honoHandler(sessionGet));
  app.post('/api/v1/auth/login', honoHandler(LoginPost));
  app.post('/api/v1/auth/register', (ctx) => {
    const bindings = ctx.env as { incoming?: unknown; server?: { incoming?: unknown } } | undefined;
    if (bindings?.incoming || bindings?.server?.incoming) {
      const address = getConnInfo(ctx).remote.address;
      if (address) setTrustedPeer(ctx.req.raw, address);
    }
    return honoHandler(RegisterPost)(ctx, async () => {});
  });
  app.post('/api/v1/auth/refresh', honoHandler(RefreshPost));
  app.post('/api/v1/auth/logout', honoHandler(LogoutPost));
  app.post('/api/v1/admin/auth/login', honoHandler(AdminLoginPost));
}
