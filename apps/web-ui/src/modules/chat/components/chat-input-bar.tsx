'use client';

import { useId, useState } from 'react';
import { ArrowUp } from 'lucide-react';

export interface ChatInputBarProps {
  disabled?: boolean;
  placeholder?: string;
  label?: string;
  onSend: (text: string) => void;
  className?: string;
}

/**
 * Thanh nhập câu hỏi/trả lời chuẩn pill capsule (chỉ gồm ô nhập và nút gửi lên).
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
    <form
      onSubmit={handleSubmit}
      className={`group relative flex w-full items-center rounded-full border border-slate-200/90 bg-white p-1.5 pl-4 shadow-sm transition-all duration-200 focus-within:border-slate-300 focus-within:shadow-md dark:border-white/10 dark:bg-ink dark:focus-within:border-white/20 sm:p-2 sm:pl-5 ${className}`}
    >
      {/* Ô nhập input chính */}
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
        className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 outline-none dark:text-gray-100 dark:placeholder-fog/60 sm:text-base"
      />

      {/* Nút gửi lên hình tròn màu xanh */}
      <button
        type="submit"
        disabled={disabled || !trimmed}
        aria-label="Gửi tin nhắn"
        title="Gửi tin nhắn"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm transition-all duration-200 hover:bg-blue-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500 sm:h-9 sm:w-9"
      >
        <ArrowUp className="h-4 w-4 stroke-[2.5]" />
      </button>
    </form>
  );
}
