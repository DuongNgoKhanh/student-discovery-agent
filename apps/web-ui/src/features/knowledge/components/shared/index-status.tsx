import { CheckCircle2, CircleAlert, Clock, Loader2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { IndexStatus as IndexState } from '../../types';

/** Same union as the API's `IndexStatus`; re-declared so the component and the type share one export. */
export type IndexStatus = IndexState;

export const INDEX_STATUS_LABELS: Record<IndexStatus, string> = {
  pending: 'Chờ xử lý',
  indexing: 'Đang index',
  ready: 'Sẵn sàng',
  error: 'Lỗi index',
};

const LOOK: Record<IndexStatus, { icon: LucideIcon; className: string; iconClassName?: string }> = {
  pending: { icon: Clock, className: 'text-muted-foreground' },
  indexing: { icon: Loader2, className: 'text-warning-foreground', iconClassName: 'animate-spin motion-reduce:animate-none' },
  ready: { icon: CheckCircle2, className: 'text-success-foreground' },
  error: { icon: CircleAlert, className: 'text-destructive' },
};

export interface IndexStatusProps {
  status: IndexStatus;
  className?: string;
  as?: 'span' | 'p' | 'div';
}

/** Icon + text + colour for a revision's index state; the text always carries the meaning. */
export function IndexStatus({ status, className, as: Tag = 'span' }: IndexStatusProps) {
  const { icon: Icon, className: tone, iconClassName } = LOOK[status];
  return (
    <Tag className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-13', tone, className)}>
      <Icon className={cn('h-4 w-4 shrink-0', iconClassName)} aria-hidden />
      {INDEX_STATUS_LABELS[status]}
    </Tag>
  );
}
