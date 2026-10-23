import { ChevronDown, GraduationCap } from 'lucide-react';
import { useId } from 'react';
import { strengthIcons } from '../sharecard/components/StrengthChips';
import type { Strength } from '../sharecard/types';
import { blockSubjects, fitTier, tierLabel, type TopMajor } from './types';

export type ScoreMode = 'tier' | 'percent';

/** Fit shown as a tier (default: avoids false precision) or as the raw percentage. */
export function FitBadge({
  score,
  mode,
  size = 'md',
  compactNarrow = false,
}: {
  score: number;
  mode: ScoreMode;
  size?: 'md' | 'sm';
  /** In narrow reports show only the meter; the label stays available to screen readers. */
  compactNarrow?: boolean;
}) {
  const tier = fitTier(score);
  if (mode === 'percent') {
    return (
      <span className="flex flex-col items-end leading-none">
        <span
          className={`font-display font-semibold text-[var(--r-accent)] ${size === 'md' ? 'text-3xl' : 'text-lg'}`}
        >
          {score}%
        </span>
        {size === 'md' && <span className="mt-1 text-xs text-[var(--r-muted)]">phù hợp</span>}
      </span>
    );
  }
  const filled = tier === 'very-high' ? 3 : tier === 'high' ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden="true" className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-1.5 w-3.5 rounded-full ${i < filled ? 'bg-[var(--r-accent)]' : 'bg-white/15'}`}
          />
        ))}
      </span>
      <span
        className={`font-semibold text-[var(--r-text)] ${size === 'md' ? 'text-sm' : 'text-xs'} ${compactNarrow ? 'sr-only @md/report:not-sr-only' : ''}`}
      >
        {tierLabel[tier]}
      </span>
    </span>
  );
}

function StrengthTag({ strength }: { strength: Strength }) {
  const Icon = strength.icon ? strengthIcons[strength.icon] : null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--r-chip-border)] bg-[var(--r-chip)] px-2.5 py-1 text-xs font-semibold text-[var(--r-text)]">
      {Icon ? <Icon size={13} aria-hidden /> : <span aria-hidden>{strength.glyph}</span>}
      {strength.label}
    </span>
  );
}

interface MajorCardProps {
  rank: number;
  major: TopMajor;
  strengths: readonly Strength[];
  mode: ScoreMode;
  open: boolean;
  onToggle(): void;
}

export function MajorCard({ rank, major, strengths, mode, open, onToggle }: MajorCardProps) {
  const panel = useId();
  const reasons = major.because.map((i) => strengths[i]).filter((s): s is Strength => !!s);
  return (
    <article
      className={`rounded-2xl border transition-colors duration-300 ${
        rank === 1
          ? 'border-[var(--r-accent-soft)] bg-[var(--r-surface-strong)] shadow-[0_0_40px_-12px_var(--r-glow)]'
          : 'border-white/10 bg-[var(--r-surface)]'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panel}
        className="flex w-full cursor-pointer items-start gap-3 p-4 text-left @xl/report:gap-4 @xl/report:p-5"
      >
        <span
          aria-hidden="true"
          className={`grid size-9 shrink-0 place-items-center rounded-full font-sans text-base font-semibold tabular-nums ${
            rank === 1
              ? 'bg-[var(--r-accent)] text-[var(--r-on-accent)]'
              : 'bg-white/10 text-[var(--r-text)]'
          }`}
        >
          {rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold tracking-[0.14em] text-[var(--r-accent)] uppercase">
            {major.group}
          </span>
          <span className="font-display mt-0.5 block text-[22px] leading-tight font-semibold text-[var(--r-text)] @xl/report:text-2xl">
            {major.name}
          </span>
          {/* Narrow cards: the fit sits under the name so the title keeps its width. */}
          <span className="mt-1.5 block @xl/report:hidden">
            <FitBadge score={major.score} mode={mode} size="sm" />
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[var(--r-muted)]">Phù hợp nhờ</span>
            {reasons.map((s) => (
              <StrengthTag key={s.label} strength={s} />
            ))}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-2">
          <span className="hidden @xl/report:block">
            <FitBadge score={major.score} mode={mode} />
          </span>
          <ChevronDown
            size={18}
            aria-hidden
            className={`text-[var(--r-muted)] transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {/* Grid-rows accordion: animates height without measuring. */}
      <div
        id={panel}
        role="region"
        aria-label={`Chi tiết ngành ${major.name}`}
        className={`grid transition-[grid-template-rows] duration-300 ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="space-y-4 px-4 pb-5 @xl/report:pr-6 @xl/report:pl-[4.25rem]">
            <p className="text-[15px] leading-relaxed text-[var(--r-body)]">{major.description}</p>
            <div>
              <h4 className="mb-2 text-xs font-semibold tracking-[0.12em] text-[var(--r-muted)] uppercase">
                Tổ hợp xét tuyển tham khảo
              </h4>
              <ul className="flex flex-wrap gap-2">
                {major.blocks.map((b) => (
                  <li
                    key={b}
                    className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-sm text-[var(--r-text)]"
                  >
                    <span className="font-semibold">{b}</span>
                    {blockSubjects[b] && (
                      <span className="text-[var(--r-muted)]"> · {blockSubjects[b]}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold tracking-[0.12em] text-[var(--r-muted)] uppercase">
                Nghề nghiệp có thể theo đuổi
              </h4>
              <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-[var(--r-body)]">
                {major.careers.map((c) => (
                  <li key={c} className="flex items-center gap-1.5">
                    <GraduationCap size={14} aria-hidden className="text-[var(--r-accent)]" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
