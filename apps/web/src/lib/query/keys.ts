/**
 * Query key tập trung. Convention: [module, entity, ...params].
 * Dùng để cache và invalidate nhất quán, ví dụ:
 *   queryClient.invalidateQueries({ queryKey: queryKeys.users.me() })
 */
export const queryKeys = {
  users: {
    me: () => ['users', 'me'] as const,
    detail: (id: string) => ['users', 'detail', id] as const,
  },
  admin: {
    users: (page: number) => ['admin', 'users', page] as const,
  },
};
