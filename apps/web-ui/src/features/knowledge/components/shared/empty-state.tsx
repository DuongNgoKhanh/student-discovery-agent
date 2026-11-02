import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-4 py-12 text-center', className)}>
      {Icon && <Icon className="h-8 w-8 text-muted-foreground/50" aria-hidden />}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-13 text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
