'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../api/admin-users';

export function useAdminUsers(cursor?: string) {
  return useQuery({
    queryKey: ['admin', 'users', cursor ?? null],
    queryFn: () => adminApi.listUsers(cursor),
  });
}
