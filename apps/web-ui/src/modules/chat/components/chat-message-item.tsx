'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Check, Copy, ThumbsDown, ThumbsUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { RenderableBlock } from '../schemas/blocks';
import { BlockRenderer } from './block-renderer';

export interface ChatMessageItemProps {
  role: 'bot' | 'user';
  text?: string;
  block?: RenderableBlock;
  showAvatar?: boolean;
  className?: string;
}

export function ChatMessageItem({
  role,
  text,
  block,
  showAvatar = true,
  className,
}: ChatMessageItemProps) {
  const [copied, setCopied] = useState(false);
  const [reaction, setReaction] = useState<'up' | 'down' | null>(null);

  const isUser = role === 'user';

  const textToCopy =
    text ||
    (block && block.kind === 'known' && block.block.type === 'text'
      ? block.block.content
      : '');

  const hasActions = !isUser && Boolean(textToCopy);

  const handleCopy = async () => {
    if (!textToCopy) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isUser) {
    return (
      <div className={cn('flex w-full items-start justify-end gap-3 animate-message-pop', className)}>
        <div className="max-w-[85%] rounded-2xl border border-slate-200/90 bg-white px-5 py-3.5 text-sm leading-relaxed text-slate-800 shadow-xs dark:border-slate-700/60 dark:bg-slate-800 dark:text-slate-100 sm:max-w-xl whitespace-pre-wrap break-words">
          {text}
        </div>
        <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-slate-200/80 bg-slate-100 shadow-xs dark:border-slate-700">
          <Image
            src="/user-avatar.png"
            alt="Avatar người dùng"
            width={32}
            height={32}
            className="h-full w-full object-cover"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex w-full items-start justify-start gap-3 animate-message-pop', className)}>
      {showAvatar ? (
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200/80 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <Image
            src="/bot-avatar.png"
            alt="Avatar trợ lý"
            width={24}
            height={24}
            className="h-6 w-6 object-contain"
          />
        </div>
      ) : (
        <div className="w-8 shrink-0" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-sm leading-relaxed text-slate-800 dark:text-slate-100">
          {block ? <BlockRenderer block={block} /> : <p className="whitespace-pre-wrap break-words">{text}</p>}
        </div>

        {hasActions && (
          <div className="mt-2 flex items-center gap-1 text-slate-400">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-slate-100 hover:text-slate-600 transition-colors dark:hover:bg-slate-800 dark:hover:text-slate-200"
              title={copied ? 'Đã sao chép' : 'Sao chép'}
              aria-label={copied ? 'Đã sao chép' : 'Sao chép'}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setReaction((prev) => (prev === 'up' ? null : 'up'))}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                reaction === 'up'
                  ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400'
                  : 'hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200'
              }`}
              title="Hài lòng"
              aria-label="Hài lòng"
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setReaction((prev) => (prev === 'down' ? null : 'down'))}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                reaction === 'down'
                  ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400'
                  : 'hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200'
              }`}
              title="Chưa hài lòng"
              aria-label="Chưa hài lòng"
            >
              <ThumbsDown className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
