import { motion, type MotionValue } from 'motion/react';
import { useLayoutEffect, useRef } from 'react';
import {
  Brain,
  Compass,
  Eye,
  Heart,
  Leaf,
  Lightbulb,
  Search,
  Sparkles,
  Target,
  UserRound,
  Users,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import type { Strength, StrengthIcon } from '../types';
import { trackProps, useOverlayMotion } from './overlay-motion';

export const strengthIcons: Record<StrengthIcon, LucideIcon> = {
  brain: Brain,
  search: Search,
  target: Target,
  sparkles: Sparkles,
  lightbulb: Lightbulb,
  compass: Compass,
  leaf: Leaf,
  waves: Waves,
  heart: Heart,
  eye: Eye,
  user: UserRound,
  users: Users,
};

interface StrengthChipsProps {
  strengths: readonly Strength[];
  time: MotionValue<number>;
}

const LABEL_MAX = 13;
const LABEL_MIN = 10.5;

/**
 * Shrink every chip label together (keeping the row's typography uniform) until none is
 * truncated. Runs on content and font changes only, never per frame.
 */
function useFitChipLabels(list: React.RefObject<HTMLUListElement | null>, key: string) {
  useLayoutEffect(() => {
    const ul = list.current;
    if (!ul) return;
    const fit = () => {
      const labels = Array.from(ul.querySelectorAll<HTMLElement>('[data-chip-label]'));
      for (let size = LABEL_MAX; size >= LABEL_MIN; size -= 0.5) {
        labels.forEach((l) => (l.style.fontSize = `${size}px`));
        if (labels.every((l) => l.scrollWidth <= l.clientWidth + 0.5)) return;
      }
    };
    fit();
    let live = true;
    void document.fonts?.ready.then(() => live && fit());
    return () => {
      live = false;
    };
  }, [list, key]);
}

export function StrengthChips({ strengths, time }: StrengthChipsProps) {
  const list = useRef<HTMLUListElement>(null);
  useFitChipLabels(list, strengths.map((s) => s.label).join('|'));
  return (
    <ul ref={list} className="flex w-full gap-2" aria-label="Điểm mạnh">
      {strengths.map((strength, i) => (
        <Chip key={i} strength={strength} index={i} count={strengths.length} time={time} />
      ))}
    </ul>
  );
}

function Chip({
  strength,
  index,
  count,
  time,
}: {
  strength: Strength;
  index: number;
  count: number;
  time: MotionValue<number>;
}) {
  const style = useOverlayMotion(time, 'chips', index, count);
  const Icon = strength.icon ? strengthIcons[strength.icon] : null;
  return (
    <motion.li {...trackProps('chips', index, count)} style={style} className="min-w-0 flex-auto">
      <div
        data-paint="box"
        className="flex h-[42px] items-center justify-center gap-[6px] overflow-hidden rounded-full border border-[var(--card-chip-border)] bg-[var(--card-chip)] px-2 backdrop-blur-[6px]"
      >
        {Icon ? (
          <span
            data-paint="svg"
            aria-hidden="true"
            className="inline-block size-[16px] shrink-0 text-[var(--card-lavender)]"
          >
            <Icon size={16} strokeWidth={1.75} className="block" />
          </span>
        ) : strength.glyph ? (
          <span
            data-paint="text"
            aria-hidden="true"
            className="text-[12px] leading-none text-[var(--card-lavender)]"
          >
            {strength.glyph}
          </span>
        ) : null}
        <span
          data-paint="text"
          data-chip-label
          className="truncate font-sans text-[13px] leading-[16px] font-semibold text-[var(--card-text)]"
        >
          {strength.label}
        </span>
      </div>
    </motion.li>
  );
}
