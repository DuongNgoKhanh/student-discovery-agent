import type { PersonalityCardBlock } from '../schemas/blocks';

type CardData = PersonalityCardBlock['data'];

/**
 * Thẻ tính cách, placeholder cho D-01. Giao diện thẻ theo Hệ thuộc D-01A và G0-04.
 * Nội dung demo luôn có nhãn Demo (FR-UI-04).
 */
export function PersonalityCard({ data }: { data: CardData }) {
  return (
    <article aria-label="Thẻ tính cách" className="rounded-xl border bg-background p-4">
      {data.is_demo && (
        <span className="mb-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
          Demo
        </span>
      )}
      <h3 className="break-words text-lg font-semibold">{data.display_name}</h3>
      <p className="break-words text-sm text-muted-foreground">{data.house.name}</p>
      <Section title="Điểm mạnh" items={data.strengths} />
      <Section title="Xu hướng" items={data.tendencies} />
      <Section title="Nhóm nghề gợi ý" items={data.career_groups} />
      <blockquote className="mt-3 break-words border-l-2 pl-3 text-sm italic">
        {data.quote}
      </blockquote>
    </article>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-sm font-medium">{title}</p>
      <ul className="list-disc pl-5 text-sm">
        {items.map((item) => (
          <li key={item} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
