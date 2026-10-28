import { Check } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type ImportStep = 1 | 2 | 3;

const STEPS: { step: ImportStep; label: string }[] = [
  { step: 1, label: 'Chọn file' },
  { step: 2, label: 'Ghép cột' },
  { step: 3, label: 'Xem trước & ghi' },
];

export interface ImportStepperProps {
  current: ImportStep;
  /** Markdown/TXT imports have no column mapping. */
  skipMapping: boolean;
}

export function ImportStepper({ current, skipMapping }: ImportStepperProps) {
  return (
    <ol aria-label="Các bước nhập file" className="mb-6 flex items-center gap-2 text-13">
      {STEPS.map(({ step, label }, index) => {
        const skipped = step === 2 && skipMapping;
        const done = step < current && !skipped;
        const active = step === current;
        return (
          <li key={step} aria-current={active ? 'step' : undefined} className="flex min-w-0 items-center gap-2">
            {index > 0 && <span aria-hidden className="h-px w-6 shrink-0 bg-border sm:w-10" />}
            <span
              aria-hidden
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                active && 'border-primary bg-primary text-primary-foreground',
                done && 'border-primary text-primary',
                !active && !done && 'text-muted-foreground',
                skipped && 'border-dashed',
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : step}
            </span>
            <span className={cn('truncate', active ? 'font-medium text-foreground' : 'text-muted-foreground', skipped && 'line-through', 'sr-only sm:not-sr-only')}>
              {label}
            </span>
            {skipped && <span className="sr-only"> (bỏ qua)</span>}
          </li>
        );
      })}
    </ol>
  );
}
