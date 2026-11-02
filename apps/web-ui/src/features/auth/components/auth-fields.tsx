'use client';

import { useState, type ComponentProps, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const inputClass =
  'w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-800 transition placeholder:text-slate-400 focus:border-[#4963a8] focus:outline-none focus:ring-2 focus:ring-[#4963a8]/20 aria-[invalid=true]:border-rose-400';

type AuthFieldProps = ComponentProps<'input'> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
};

/** Ô nhập của form auth: label, gợi ý và lỗi được nối với input qua `aria-describedby`. */
export function AuthTextField({ id, label, error, hint, className, ...props }: AuthFieldProps) {
  return (
    <FieldFrame id={id} label={label} error={error} hint={hint}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(inputClass, className)}
        {...props}
      />
    </FieldFrame>
  );
}

/** Ô mật khẩu có nút ẩn/hiện. */
export function AuthPasswordField({ id, label, error, hint, className, ...props }: AuthFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <FieldFrame id={id} label={label} error={error} hint={hint}>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          className={cn(inputClass, 'pr-10', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          aria-pressed={visible}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded text-slate-400 transition hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4963a8]/40"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </FieldFrame>
  );
}

function FieldFrame({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: string) {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}
