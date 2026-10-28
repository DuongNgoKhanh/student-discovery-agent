import { Briefcase, Quote, Sparkles, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PersonalityCardBlock } from '../schemas/blocks';

type CardData = PersonalityCardBlock['data'];

/**
 * Thẻ tính cách, placeholder cho D-01. Giao diện thẻ theo Hệ thuộc D-01A và G0-04.
 * Nội dung demo luôn có nhãn Demo (FR-UI-04).
 */
export function PersonalityCard({ data }: { data: CardData }) {
  return (
    <article
      aria-label="Thẻ tính cách"
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-md dark:border-white/10 dark:bg-edge/40"
    >
      <header className="bg-gradient-to-br from-primary to-primary/80 px-5 py-4 text-primary-foreground">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider opacity-80">{data.house.name}</p>
            <h3 className="mt-0.5 break-words text-xl font-semibold">{data.display_name}</h3>
          </div>
          {data.is_demo && (
            <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">
              Demo
            </span>
          )}
        </div>
      </header>
      <div className="flex flex-col gap-4 p-5">
        <Section title="Điểm mạnh" icon={Sparkles} items={data.strengths} />
        <Section title="Xu hướng" icon={TrendingUp} items={data.tendencies} />
        <Section title="Nhóm nghề gợi ý" icon={Briefcase} items={data.career_groups} />
        <blockquote className="flex gap-2.5 rounded-xl bg-muted px-4 py-3 text-sm italic text-muted-foreground">
          <Quote className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="break-words">{data.quote}</span>
        </blockquote>
      </div>
    </article>
  );
}

function Section({ title, icon: Icon, items }: { title: string; icon: LucideIcon; items: string[] }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        {title}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <li
            key={item}
            className="break-words rounded-lg bg-primary-subtle px-2.5 py-1 text-sm text-foreground"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
