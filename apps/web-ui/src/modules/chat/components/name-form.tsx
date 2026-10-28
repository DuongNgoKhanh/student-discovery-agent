'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowUp } from 'lucide-react';
import { displayNameSchema } from '../schemas/display-name';

const formSchema = z.object({ display_name: displayNameSchema });
type FormValues = z.input<typeof formSchema>;

/** Onboarding: nhập tên hợp lệ mới mở được phiên (QT-02). Tên không tính là đáp án. */
export function NameForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (displayName: string) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  return (
    <form
      noValidate
      onSubmit={handleSubmit((values) => onSubmit(formSchema.parse(values).display_name))}
      className="flex flex-col gap-2"
    >
      <label
        htmlFor="display-name"
        className="text-sm font-medium text-slate-700 dark:text-slate-300"
      >
        Mình gọi bạn là gì nhỉ?
      </label>
      <div className="group relative flex w-full items-center rounded-full border border-slate-200/90 bg-white p-1.5 pl-4 shadow-sm transition-all duration-200 focus-within:border-[#4963a8]/60 focus-within:shadow-md focus-within:ring-2 focus-within:ring-[#4963a8]/20 dark:border-white/10 dark:bg-ink dark:focus-within:border-[#7c9bff]/50 dark:focus-within:ring-[#7c9bff]/20 sm:p-2 sm:pl-5">
        <input
          id="display-name"
          autoComplete="given-name"
          placeholder="Nhập vào"
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 outline-none dark:text-gray-100 dark:placeholder-fog/60 sm:text-base"
          disabled={disabled}
          {...register('display_name')}
        />
        <button
          type="submit"
          disabled={disabled}
          aria-label="Gửi"
          title="Gửi"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4963a8] text-white shadow-sm shadow-[#4963a8]/25 transition-all duration-200 hover:bg-[#3d5492] active:scale-95 active:bg-[#34487d] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#4963a8] dark:hover:bg-[#3d5492] sm:h-9 sm:w-9"
        >
          <ArrowUp className="h-4 w-4 stroke-[2.5]" />
        </button>
      </div>
      {errors.display_name && (
        <span role="alert" className="pl-3 text-sm text-red-600">
          {errors.display_name.message}
        </span>
      )}
    </form>
  );
}
