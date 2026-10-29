'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Check, Copy, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { RenderableBlock } from '../schemas/blocks';
import { BlockRenderer } from './block-renderer';

export interface ChatMessageItemProps {
  id?: string;
  role: 'bot' | 'user';
  text?: string;
  block?: RenderableBlock;
  showAvatar?: boolean;
  className?: string;
  onReact?: (id: string | undefined, reaction: 'up' | 'down') => void;
}

export function ChatMessageItem({
  id,
  role,
  text,
  block,
  showAvatar = true,
  className,
  onReact,
}: ChatMessageItemProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [reaction, setReaction] = useState<'up' | 'down' | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const isUser = role === 'user';

  const textToCopy =
    text ||
    (block && block.kind === 'known' && block.block.type === 'text'
      ? block.block.content
      : '');

  const hasActions = !isUser && Boolean(textToCopy);

  const handleCopy = async () => {
    if (!textToCopy) return;
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);

    const success = (await copyWithClipboardApi(textToCopy)) || copyWithExecCommand(textToCopy);
    setCopyStatus(success ? 'copied' : 'failed');
    copyTimerRef.current = setTimeout(() => setCopyStatus('idle'), 2000);
  };

  const handleReaction = (type: 'up' | 'down') => {
    const next = reaction === type ? null : type;
    setReaction(next);
    if (next && onReact) {
      onReact(id, next);
    }
  };

  if (isUser) {
    return (
      <div className={cn('flex w-full items-end justify-end gap-2.5 animate-message-pop', className)}>
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground shadow-sm sm:max-w-xl">
          {text}
        </div>
        <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-border">
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

  const copyLabel =
    copyStatus === 'copied' ? 'Đã sao chép' : copyStatus === 'failed' ? 'Không thể sao chép' : 'Sao chép';

  return (
    <div className={cn('group/msg flex w-full items-start justify-start gap-3 animate-message-pop', className)}>
      {showAvatar ? <BotAvatar /> : <div className="w-8 shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1 pt-1">
        <div className="text-[15px] leading-7 text-foreground">
          {block ? <BlockRenderer block={block} /> : <p className="whitespace-pre-wrap break-words">{text}</p>}
        </div>

        {hasActions && (
          <div className="-ml-1.5 mt-1 flex items-center gap-0.5 text-muted-foreground transition-opacity duration-200 md:opacity-0 md:focus-within:opacity-100 md:group-hover/msg:opacity-100">
            <button
              type="button"
              onClick={handleCopy}
              className={ACTION_BUTTON_CLASS}
              title={copyLabel}
              aria-label={copyLabel}
            >
              {copyStatus === 'copied' ? (
                <Check className="h-4 w-4 text-status-success" aria-hidden="true" />
              ) : copyStatus === 'failed' ? (
                <X className="h-4 w-4 text-destructive" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={() => handleReaction('up')}
              aria-pressed={reaction === 'up'}
              className={cn(
                ACTION_BUTTON_CLASS,
                reaction === 'up' && 'bg-primary-subtle text-primary hover:bg-primary-subtle',
              )}
              title="Hài lòng"
              aria-label="Hài lòng"
            >
              <ThumbsUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => handleReaction('down')}
              aria-pressed={reaction === 'down'}
              className={cn(
                ACTION_BUTTON_CLASS,
                reaction === 'down' && 'bg-destructive-subtle text-destructive hover:bg-destructive-subtle',
              )}
              title="Chưa hài lòng"
              aria-label="Chưa hài lòng"
            >
              <ThumbsDown className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const ACTION_BUTTON_CLASS =
  'inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Avatar trợ lý, dùng chung cho tin nhắn bot và chỉ báo đang trả lời. */
export function BotAvatar() {
  return (
    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-sm ring-1 ring-border dark:ring-white/10">
      <Image
        src="/bot-avatar.png"
        alt="Avatar trợ lý"
        width={24}
        height={24}
        className="h-6 w-6 object-contain"
      />
    </div>
  );
}

async function copyWithClipboardApi(text: string): Promise<boolean> {
  // Clipboard API chỉ có trong ngữ cảnh an toàn (HTTPS/localhost) và có thể bị từ chối quyền.
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function copyWithExecCommand(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.setAttribute('readonly', '');
  document.body.appendChild(textarea);
  try {
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
