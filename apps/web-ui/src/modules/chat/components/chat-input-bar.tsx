'use client';

import { useId, useState } from 'react';
import { ArrowUp, AudioLines, Brain, Mic, Plus } from 'lucide-react';

export interface ChatInputBarProps {
  disabled?: boolean;
  placeholder?: string;
  onSend: (text: string) => void;
  onPlusClick?: () => void;
  onReasoningClick?: () => void;
  onMicClick?: () => void;
  className?: string;
}

/**
 * Thanh nhập câu hỏi/trả lời chuẩn pill capsule theo phong cách ChatGPT (Image 1).
 * Gồm: Nút `+`, ô nhập text, nút `Suy luận` (kèm icon não), nút micro và nút tròn xanh.
 */
export function ChatInputBar({
  disabled = false,
  placeholder = 'Hỏi ChatGPT',
  onSend,
  onPlusClick,
  onReasoningClick,
  onMicClick,
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

  return (
    <form
      onSubmit={handleSubmit}
      className={`group relative flex w-full items-center gap-1.5 rounded-full border border-slate-200/90 bg-white p-1.5 pl-2.5 shadow-xs transition-all duration-200 focus-within:border-slate-300 focus-within:shadow-md dark:border-white/10 dark:bg-ink dark:focus-within:border-white/20 sm:gap-2 sm:p-2 sm:pl-3 ${className}`}
    >
      {/* Nút dấu cộng (+) bên trái */}
      <button
        type="button"
        disabled={disabled}
        onClick={onPlusClick}
        aria-label="Thêm tùy chọn"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200 sm:h-9 sm:w-9"
      >
        <Plus className="h-4 w-4 sm:h-5 sm:w-5" />
      </button>

      {/* Ô nhập input chính */}
      <label htmlFor={inputId} className="sr-only">
        {placeholder}
      </label>
      <input
        id={inputId}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent px-1.5 text-sm text-slate-800 placeholder-slate-400 outline-none dark:text-gray-100 dark:placeholder-fog/60 sm:px-2 sm:text-base"
      />

      {/* Nhóm thao tác bên phải */}
      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        {/* Nút Suy luận */}
        <button
          type="button"
          disabled={disabled}
          onClick={onReasoningClick}
          aria-label="Suy luận"
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-white/10 sm:text-sm"
        >
          <Brain className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400 sm:h-4 sm:w-4" />
          <span className="hidden xs:inline">Suy luận</span>
        </button>

        {/* Nút Micro */}
        <button
          type="button"
          disabled={disabled}
          onClick={onMicClick}
          aria-label="Nhập bằng giọng nói"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200 sm:h-9 sm:w-9"
        >
          <Mic className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
        </button>

        {/* Nút tròn màu xanh (Voice wave khi rỗng, Mũi tên gửi khi có chữ) */}
        <button
          type="submit"
          disabled={disabled || (!trimmed && !onMicClick)}
          aria-label={trimmed ? 'Gửi tin nhắn' : 'Ghi âm giọng nói'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-xs transition-all duration-200 hover:bg-blue-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500 sm:h-9 sm:w-9"
        >
          {trimmed ? (
            <ArrowUp className="h-4 w-4 stroke-[2.5]" />
          ) : (
            <AudioLines className="h-4 w-4" />
          )}
        </button>
      </div>
    </form>
  );
}
