import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/errors';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Không retry lỗi không thể thử lại (retryable=false), còn lại retry tối đa 2 lần.
        retry: (count, error) =>
          error instanceof ApiError && !error.retryable ? false : count < 2,
      },
    },
  });
}
