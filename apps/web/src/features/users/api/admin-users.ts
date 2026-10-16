import { api } from '@/lib/api/client';
import type { AdminUser } from '../types';

export const adminApi = {
  listUsers: (page: number) => api.get<AdminUser[]>(`admin/users?page=${page}`),
};
