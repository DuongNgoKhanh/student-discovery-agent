'use client';

import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface TagInputProps {
  value: string[];
  onChange: (value: string[]) => void;
  /** Accessible name of the text input. */
  label: string;
  id?: string;
  autoFocus?: boolean;
  invalid?: boolean;
  describedBy?: string;
  /** Focus left the whole control (tags and input); pending text is committed first. */
  onDone?: () => void;
  className?: string;
}

/** Enter or ";" adds a tag, Backspace on an empty input removes the last one. */
export function TagInput({ value, onChange, label, id, autoFocus, invalid, describedBy, onDone, className }: TagInputProps) {
  const [draft, setDraft] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const add = (items: string[]) => {
    const next = [...value];
    for (const item of items.map(text => text.trim()).filter(Boolean)) if (!next.includes(item)) next.push(item);
    if (next.length !== value.length) onChange(next);
  };
  const commitDraft = () => { add([draft]); setDraft(''); };

  return (
    <div
      ref={root}
      className={cn(
        'flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1 text-sm focus-within:ring-2 focus-within:ring-ring',
        invalid && 'border-destructive',
        className,
      )}
      onBlur={event => {
        if (root.current?.contains(event.relatedTarget as Node | null)) return;
        commitDraft();
        onDone?.();
      }}
    >
      {value.map((tag, index) => (
        <span key={tag} className="inline-flex items-center gap-0.5 rounded bg-muted py-0.5 pl-1.5 pr-0.5 text-13">
          {tag}
          <button
            type="button" aria-label={`Xoá ${tag}`}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => { onChange(value.filter((_, i) => i !== index)); input.current?.focus(); }}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      <input
        ref={input} id={id} aria-label={label} autoFocus={autoFocus} value={draft}
        aria-invalid={invalid || undefined} aria-describedby={describedBy}
        className="h-6 min-w-[6rem] flex-1 bg-transparent px-1 outline-none"
        onChange={event => {
          // Typing or pasting ";" splits: everything before the last separator becomes tags.
          const parts = event.target.value.split(';');
          if (parts.length > 1) { add(parts.slice(0, -1)); setDraft(parts.at(-1) ?? ''); } else setDraft(event.target.value);
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); commitDraft(); }
          else if (event.key === 'Backspace' && draft === '' && value.length > 0) onChange(value.slice(0, -1));
          else if (event.key === 'Escape') { event.preventDefault(); commitDraft(); onDone?.(); }
        }}
      />
    </div>
  );
}
