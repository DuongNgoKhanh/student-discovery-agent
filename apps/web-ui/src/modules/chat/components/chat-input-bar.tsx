'use client';

import { useId, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/** Khung composer dùng chung cho ô nhập tự do và form nhập tên. */
export const COMPOSER_CLASS =
  'group relative flex w-full items-center gap-2 rounded-2xl border border-input bg-card p-2 pl-4 shadow-sm transition-[border-color,box-shadow] duration-200 focus-within:border-primary/50 focus-within:shadow-md focus-within:ring-4 focus-within:ring-primary/10 dark:border-white/10 dark:bg-ink dark:focus-within:border-primary/50';

export const COMPOSER_INPUT_CLASS =
  'min-w-0 flex-1 bg-transparent py-1.5 text-[15px] text-foreground placeholder:text-muted-foreground/80 outline-none disabled:cursor-not-allowed';

export const SEND_BUTTON_CLASS =
  'flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-[background-color,opacity,transform] duration-150 hover:bg-primary/90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100';

export interface ChatInputBarProps {
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  onSend: (text: string) => void;
  className?: string;
}

/**
 * Thanh nhập câu hỏi/trả lời (chỉ gồm ô nhập và nút gửi lên).
 */
export function ChatInputBar({
  disabled = false,
  placeholder = 'Nhập vào',
  label,
  onSend,
  className = '',
}: ChatInputBarProps) {
  const [text, setText] = useState('');
  const inputId = useId();
  const trimmed = text.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  };

  const accessibleLabel = label ?? placeholder;

  return (
    <form onSubmit={handleSubmit} className={cn(COMPOSER_CLASS, className)}>
      <label htmlFor={inputId} className="sr-only">
        {accessibleLabel}
      </label>
      <input
        id={inputId}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        className={COMPOSER_INPUT_CLASS}
      />
      <button
        type="submit"
        disabled={disabled || !trimmed}
        aria-label="Gửi tin nhắn"
        title="Gửi tin nhắn"
        className={SEND_BUTTON_CLASS}
      >
        <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />
      </button>
    </form>
  );
}
