import {
  Bot,
  Box,
  LibraryBig,
  MessageSquareText,
  Play,
  Sparkles,
  Split,
  Tags,
  UserRoundPen,
  Variable,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface NodeVisual {
  icon: LucideIcon;
  /** Icon tile background and foreground. */
  tile: string;
  /** Branch dot on the canvas, in the same hue as the tile. */
  dot: string;
  /** The same hue as a plain background, for markers outside the canvas. */
  swatch: string;
}

// Full class strings, so Tailwind's scanner keeps them.
const VISUALS: Record<string, NodeVisual> = {
  start: { icon: Play, tile: 'bg-primary text-primary-foreground', dot: '!bg-primary', swatch: 'bg-primary' },
  if_else: { icon: Split, tile: 'bg-cyan-600 text-white', dot: '!bg-cyan-600', swatch: 'bg-cyan-600' },
  intent_classifier: { icon: Tags, tile: 'bg-violet-600 text-white', dot: '!bg-violet-600', swatch: 'bg-violet-600' },
  llm: { icon: Sparkles, tile: 'bg-indigo-600 text-white', dot: '!bg-indigo-600', swatch: 'bg-indigo-600' },
  agent: { icon: Bot, tile: 'bg-blue-600 text-white', dot: '!bg-blue-600', swatch: 'bg-blue-600' },
  knowledge_retrieval: { icon: LibraryBig, tile: 'bg-emerald-600 text-white', dot: '!bg-emerald-600', swatch: 'bg-emerald-600' },
  tool: { icon: Wrench, tile: 'bg-amber-500 text-white', dot: '!bg-amber-500', swatch: 'bg-amber-500' },
  profile_propose: { icon: UserRoundPen, tile: 'bg-pink-600 text-white', dot: '!bg-pink-600', swatch: 'bg-pink-600' },
  assign: { icon: Variable, tile: 'bg-teal-600 text-white', dot: '!bg-teal-600', swatch: 'bg-teal-600' },
  answer: { icon: MessageSquareText, tile: 'bg-orange-500 text-white', dot: '!bg-orange-500', swatch: 'bg-orange-500' },
};

const UNKNOWN: NodeVisual = { icon: Box, tile: 'bg-muted-foreground text-background', dot: '!bg-muted-foreground', swatch: 'bg-muted-foreground' };

export function nodeVisual(type: string): NodeVisual {
  return VISUALS[type] ?? UNKNOWN;
}

export function NodeIcon({ type, size = 'md', className }: { type: string; size?: 'sm' | 'md'; className?: string }) {
  const { icon: Icon, tile } = nodeVisual(type);
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        size === 'sm' ? 'size-5 rounded-md' : 'size-7 rounded-lg',
        tile,
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'size-3' : 'size-4'} strokeWidth={2.25} />
    </span>
  );
}
