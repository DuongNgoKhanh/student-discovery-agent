'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/keys';
import { usersApi } from '../api/users';

export function useMe() {
  return useQuery({ queryKey: queryKeys.users.me(), queryFn: usersApi.me });
}
