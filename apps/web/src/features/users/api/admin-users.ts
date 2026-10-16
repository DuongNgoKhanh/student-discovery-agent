import { api } from '@/lib/api/client';
import type { User } from '../types';

export const adminApi = {
  listUsers: (page: number) => api.get<User[]>(`admin/users?page=${page}`),
};
