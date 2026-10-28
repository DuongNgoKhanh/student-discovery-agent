'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, ArrowUp } from 'lucide-react';
import { displayNameSchema } from '../schemas/display-name';
import { COMPOSER_CLASS, COMPOSER_INPUT_CLASS, SEND_BUTTON_CLASS } from './chat-input-bar';

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
      className="flex flex-col gap-2.5"
    >
      <label htmlFor="display-name" className="text-sm font-semibold text-foreground">
        Mình gọi bạn là gì nhỉ?
      </label>
      <div className={COMPOSER_CLASS}>
        <input
          id="display-name"
          autoComplete="given-name"
          placeholder="Nhập vào"
          aria-invalid={errors.display_name ? true : undefined}
          aria-describedby={errors.display_name ? 'display-name-error' : undefined}
          className={COMPOSER_INPUT_CLASS}
          disabled={disabled}
          {...register('display_name')}
        />
        <button type="submit" disabled={disabled} aria-label="Gửi" title="Gửi" className={SEND_BUTTON_CLASS}>
          <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />
        </button>
      </div>
      {errors.display_name && (
        <span
          id="display-name-error"
          role="alert"
          className="flex items-center gap-1.5 pl-1 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {errors.display_name.message}
        </span>
      )}
    </form>
  );
}
