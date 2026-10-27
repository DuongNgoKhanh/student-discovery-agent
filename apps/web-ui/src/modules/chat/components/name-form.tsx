'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
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
      <label htmlFor="display-name" className="text-sm font-medium">
        Mình gọi bạn là gì nhỉ?
      </label>
      <div className="flex gap-2">
        <input
          id="display-name"
          autoComplete="given-name"
          className="min-w-0 flex-1 rounded-md border px-3 py-2 text-base"
          disabled={disabled}
          {...register('display_name')}
        />
        <Button type="submit" disabled={disabled}>
          Gửi
        </Button>
      </div>
      {errors.display_name && (
        <span role="alert" className="text-sm text-red-600">
          {errors.display_name.message}
        </span>
      )}
    </form>
  );
}
