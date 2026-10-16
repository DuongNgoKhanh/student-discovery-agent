import type { Hono } from 'hono';
import { honoHandler } from '@/http/handler';
import { handlePost as LoginPost } from './routes/login';
import { handlePost as RegisterPost } from './routes/register';
import { handlePost as RefreshPost } from './routes/refresh';
import { handlePost as LogoutPost } from './routes/logout';
import { handlePost as AdminLoginPost } from './routes/admin-login';

export function registerAuthRoutes(app: Hono): void {
  app.post('/api/v1/auth/login', honoHandler(LoginPost));
  app.post('/api/v1/auth/register', honoHandler(RegisterPost));
  app.post('/api/v1/auth/refresh', honoHandler(RefreshPost));
  app.post('/api/v1/auth/logout', honoHandler(LogoutPost));
  app.post('/api/v1/admin/auth/login', honoHandler(AdminLoginPost));
}
