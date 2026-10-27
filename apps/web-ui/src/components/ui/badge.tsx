import { cn } from '@/lib/utils/cn';

const TONES = {
  neutral: 'bg-gray-100 text-gray-700',
  info: 'bg-blue-100 text-blue-700',
  success: 'bg-green-100 text-green-700',
  danger: 'bg-red-100 text-red-700',
} as const;

export function Badge({ tone = 'neutral', className, children }: { tone?: keyof typeof TONES; className?: string; children: React.ReactNode }) {
  return <span className={cn('inline-flex rounded px-2 py-0.5 text-xs font-medium', TONES[tone], className)}>{children}</span>;
}
