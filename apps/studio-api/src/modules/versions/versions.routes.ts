import type { Hono } from 'hono';
import { honoHandler } from '@/http/handler';
import { handleGet as VersionsGet, handlePost as VersionsPost } from './routes/versions';

export function registerVersionsRoutes(app: Hono): void {
  app.get('/api/v1/versions', honoHandler(VersionsGet));
  app.post('/api/v1/versions', honoHandler(VersionsPost));
}
