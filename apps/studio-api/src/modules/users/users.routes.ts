import type { Hono } from 'hono';
import { honoHandler } from '@/http/handler';
import { handleGet as MeGet, handlePut as MePut } from './routes/me';
import { handleGet as UsersGet } from './routes/users';
import { handleGet as AdminUsersGet, handlePost as AdminUsersPost, handleDelete as AdminUsersDelete } from './routes/admin-users';
import { handleGet as AdminUserGet, handlePut as AdminUserPut, handleDelete as AdminUserDelete } from './routes/admin-user';
import { handlePost as RestoreUserPost } from './routes/restore-user';
import { handlePost as BulkCreatePost } from './routes/bulk-create';
import { handlePut as BulkUpdatePut } from './routes/bulk-update';
import { handlePost as AvatarUploadPost } from './routes/avatar-upload';
import { handleGet as AvatarGet } from './routes/avatar';
import { handleGet as DownloadGet } from './routes/download';

export function registerUsersRoutes(app: Hono): void {
  app.get('/api/v1/me', honoHandler(MeGet));
  app.put('/api/v1/me', honoHandler(MePut));
  app.get('/api/v1/users', honoHandler(UsersGet));
  app.get('/api/v1/admin/users', honoHandler(AdminUsersGet));
  app.post('/api/v1/admin/users', honoHandler(AdminUsersPost));
  app.delete('/api/v1/admin/users', honoHandler(AdminUsersDelete));
  app.get('/api/v1/admin/users/:user_id', honoHandler(AdminUserGet));
  app.put('/api/v1/admin/users/:user_id', honoHandler(AdminUserPut));
  app.delete('/api/v1/admin/users/:user_id', honoHandler(AdminUserDelete));
  app.post('/api/v1/admin/users/:user_id/restore', honoHandler(RestoreUserPost));
  app.post('/api/v1/admin/users/bulk/create', honoHandler(BulkCreatePost));
  app.put('/api/v1/admin/users/bulk/update', honoHandler(BulkUpdatePut));
  app.post('/api/v1/users/avatar/upload', honoHandler(AvatarUploadPost));
  app.get('/api/v1/users/:user_id/avatar', honoHandler(AvatarGet));
  app.get('/api/v1/download', honoHandler(DownloadGet));
  app.get('/download', honoHandler(DownloadGet));
}
