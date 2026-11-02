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
import { Sparkle } from './Ornaments';
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

const LABEL_MAX = 14;
const LABEL_MIN = 9.5;

/**
 * Shrink every chip label together (keeping the row's typography uniform) until the row fits.
 * Labels never truncate, so the row overflows instead; any sub-pixel overflow left by the
 * rounded widths falls into the capsule's padding. Runs on content, font and row-size changes
 * only, never per frame.
 */
function useFitChipLabels(list: React.RefObject<HTMLUListElement | null>, key: string) {
  useLayoutEffect(() => {
    const ul = list.current;
    if (!ul) return;
    const fit = () => {
      const labels = Array.from(ul.querySelectorAll<HTMLElement>('[data-chip-label]'));
      for (let size = LABEL_MAX; size >= LABEL_MIN; size -= 0.5) {
        labels.forEach((l) => (l.style.fontSize = `${size}px`));
        if (ul.scrollWidth <= ul.clientWidth) return;
      }
    };
    fit();
    let live = true;
    void document.fonts?.ready.then(() => live && fit());
    // The row can mount before it has its final width; fit again once it is laid out. The row's
    // width is fixed by its container, so resizing the labels never re-triggers this.
    const resize = new ResizeObserver(() => live && fit());
    resize.observe(ul);
    return () => {
      live = false;
      resize.disconnect();
    };
  }, [list, key]);
}

export function StrengthChips({ strengths, time }: StrengthChipsProps) {
  const list = useRef<HTMLUListElement>(null);
  useFitChipLabels(list, strengths.map((s) => s.label).join('|'));
  return (
    <ul ref={list} className="flex w-full gap-3" aria-label="Điểm mạnh">
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
  // Sparkles alternate gold and violet across the row, as on the reference card.
  const tone = index % 2 ? 'text-[var(--card-accent)]' : 'text-[var(--card-ornament)]';
  return (
    <motion.li
      {...trackProps('chips', index, count)}
      style={style}
      className="flex flex-auto items-center justify-center gap-[7px]"
    >
      <Sparkle size={11} className={tone} />
      <span
        data-paint="text"
        data-chip-label
        className="font-sans text-[14px] leading-[24px] font-normal whitespace-nowrap text-[var(--card-text)]"
      >
        {strength.label}
      </span>
    </motion.li>
  );
}
