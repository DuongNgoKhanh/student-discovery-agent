import type { RenderableBlock } from '../schemas/blocks';
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
        className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
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
        <div className="rounded-lg bg-muted p-3">
          <p className="break-words font-medium">{b.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Tiến độ {b.progress.completed}/{b.progress.total}
          </p>
        </div>
      );

    case 'assessment_clarification':
      return (
        <div className="rounded-lg bg-muted p-3">
          <p className="break-words font-medium">{b.title}</p>
        </div>
      );

    case 'personality_card':
      return <PersonalityCard data={b.data} />;
  }
}
