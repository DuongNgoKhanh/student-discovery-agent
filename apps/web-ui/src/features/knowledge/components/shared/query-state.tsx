'use client';

import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from './empty-state';
import { errorMessage } from './error-message';

export interface QueryStateProps<T> {
  query: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown };
  /** Rendered when `isEmpty(data)` is true. */
  isEmpty?: (data: T) => boolean;
  empty?: React.ReactNode;
  /** Replaces the default 3-line skeleton. */
  loading?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}

export function QueryState<T>({ query, isEmpty, empty, loading, children }: QueryStateProps<T>) {
  if (query.isLoading) {
    return loading ?? (
      <div aria-busy="true" aria-label="Đang tải" className="space-y-2">
        <Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-2/3" />
      </div>
    );
  }
  if (query.error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border px-4 py-3 text-sm">
        <p className="text-destructive">{errorMessage(query.error)}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          <RotateCw className="h-4 w-4" aria-hidden />Thử lại
        </Button>
      </div>
    );
  }
  if (query.data === undefined) return null;
  if (isEmpty?.(query.data)) return empty ?? <EmptyState title="Chưa có dữ liệu" />;
  return children(query.data);
}
