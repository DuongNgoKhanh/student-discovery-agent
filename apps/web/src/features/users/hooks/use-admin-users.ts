'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { adminApi } from '../api/admin-users';

export function useAdminUsers(page: number) {
  return useQuery({
    queryKey: queryKeys.admin.users(page),
    queryFn: () => adminApi.listUsers(page),
  });
}
