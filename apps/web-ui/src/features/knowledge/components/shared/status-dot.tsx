import { cn } from '@/lib/utils/cn';

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral';

const DOT: Record<StatusTone, string> = {
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  danger: 'bg-status-danger',
  neutral: 'bg-status-neutral',
};

export interface StatusDotProps {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}

/** Colour is decoration only; the text always carries the status. */
export function StatusDot({ tone, children, className }: StatusDotProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-13', className)}>
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[tone])} />
      {children}
    </span>
  );
}
