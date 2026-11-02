import { AuraCard, archetypeForHouse } from '@/modules/aura-card';
import type { PersonalityCardBlock } from '../schemas/blocks';

type CardData = PersonalityCardBlock['data'];

/**
 * Thẻ tính cách (D-01). Hệ có thiết kế Digital Aura thì hiện thẻ động kèm lưu/chia sẻ ảnh;
 * hệ chưa có thiết kế thì hiện thẻ chữ. Phần giải thích kết quả do Agent gửi trong tin nhắn ngay sau thẻ.
 * Nội dung demo luôn có nhãn Demo (FR-UI-04), cả trên thẻ và trong ảnh lưu.
 */
export function PersonalityCard({ data }: { data: CardData }) {
  const archetype = archetypeForHouse(data.house);
  return (
    <article
      aria-label="Thẻ tính cách"
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-md dark:border-white/10 dark:bg-edge/40"
    >
      {archetype ? (
        <div className="px-3 pb-4 pt-4">
          <AuraCard entry={archetype} name={data.display_name} demo={data.is_demo} />
        </div>
      ) : (
        <header className="bg-gradient-to-br from-primary to-primary/80 px-5 py-4 text-primary-foreground">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wider opacity-80">
                {data.house.name}
              </p>
              <h3 className="mt-0.5 break-words text-xl font-semibold">{data.display_name}</h3>
            </div>
            {data.is_demo && (
              <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
                Demo
              </span>
            )}
          </div>
        </header>
      )}
    </article>
  );
}
