import { api } from '@/lib/api/client';
import type { AdminUser } from '../types';

export const adminApi = {
  listUsers: async (cursor?: string) => {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const { items } = await api.get<{ items: AdminUser[] }>(`admin/users${query}`);
    return items;
  },
};
