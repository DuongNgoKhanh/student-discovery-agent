import { HelpCircle } from 'lucide-react';
import { progressLabel, type AssessmentProgress, type RenderableBlock } from '../schemas/blocks';
import { PersonalityCard } from './personality-card';

/**
 * Hiển thị một block trong transcript (chỉ đọc). Thao tác học sinh nằm ở ActivityControls,
 * để chỉ có một nơi duy nhất gửi action với revision hiện hành.
 * Nội dung từ server là text thuần (FR-UI-01): không dùng dangerouslySetInnerHTML.
 */
export function BlockRenderer({ block }: { block: RenderableBlock }) {
  if (block.kind === 'unsupported') {
    return (
      <div
        role="note"
        className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground"
      >
        Nội dung này cần phiên bản mới hơn để hiển thị.
      </div>
    );
  }

  const b = block.block;
  switch (b.type) {
    case 'text':
      return <p className="whitespace-pre-wrap break-words">{b.content}</p>;

    case 'assessment_question':
      return (
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm dark:border-white/10 dark:bg-edge/40">
          <p className="break-words font-semibold leading-snug">{b.title}</p>
          <ProgressBar progress={b.progress} />
        </div>
      );

    case 'assessment_clarification':
      return (
        <div className="flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary-subtle p-4">
          <HelpCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p className="break-words font-medium leading-snug">{b.title}</p>
        </div>
      );

    case 'personality_card':
      return <PersonalityCard data={b.data} />;
  }
}

/** Thanh tiến độ: tổng chưa chốt (adaptive) thì so với `max_total` để không vượt 100%. */
function ProgressBar({ progress }: { progress: AssessmentProgress }) {
  const denominator = progress.total ?? progress.max_total ?? null;
  const percent = denominator ? Math.min(100, Math.round((progress.completed / denominator) * 100)) : null;

  return (
    <div className="mt-3 flex items-center gap-3">
      {percent !== null && (
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      <p className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
        Tiến độ {progressLabel(progress)}
      </p>
    </div>
  );
}
