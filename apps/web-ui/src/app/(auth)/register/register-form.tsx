'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AuthPasswordField,
  AuthTextField,
  PASSWORD_POLICY_HINT,
  registerSchema,
  type RegisterInput,
  useRegister,
} from '@/features/auth';
import { safeNext, withNext } from '@/lib/auth/safe-next';
import { Button } from '@/components/ui/button';

export function RegisterForm() {
  const router = useRouter();
  const rawNext = useSearchParams().get('next');
  const next = safeNext(rawNext);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });
  const { mutateAsync, isPending, error } = useRegister();

  async function onSubmit(values: RegisterInput) {
    try {
      await mutateAsync(values);
    } catch {
      return; // Lỗi đã hiển thị qua `error` của mutation.
    }
    router.push(next);
  }

  return (
    <>
      <div className="mb-6 space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 sm:text-3xl">
          Tạo tài khoản
        </h1>
        <p className="text-xs text-slate-500 sm:text-sm">
          Bắt đầu hành trình khám phá nghề nghiệp cùng trợ lý hướng nghiệp.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <AuthTextField
          id="name"
          label="Họ và tên"
          type="text"
          autoComplete="name"
          placeholder="Nguyễn Văn A"
          error={errors.name?.message}
          {...register('name')}
        />
        <AuthTextField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="ban@example.com"
          error={errors.email?.message}
          {...register('email')}
        />
        <AuthPasswordField
          id="password"
          label="Mật khẩu"
          autoComplete="new-password"
          hint={PASSWORD_POLICY_HINT}
          error={errors.password?.message}
          {...register('password')}
        />

        <Button
          type="submit"
          disabled={isPending}
          className="w-full rounded-xl bg-[#4963a8] py-2.5 text-sm font-semibold text-white shadow-md shadow-[#4963a8]/20 transition hover:bg-[#3d5492] active:bg-[#34487d] disabled:opacity-60"
        >
          {isPending ? 'Đang xử lý...' : 'Tạo tài khoản'}
        </Button>

        {error && (
          <div
            role="alert"
            className="rounded-lg bg-rose-50 p-2.5 text-center text-xs text-rose-700"
          >
            {(error as Error).message}
          </div>
        )}

        <p className="pt-2 text-center text-xs text-slate-500 sm:text-sm">
          Đã có tài khoản?{' '}
          <Link
            href={withNext('/login', rawNext)}
            className="font-semibold text-[#4963a8] underline"
          >
            Đăng nhập
          </Link>
        </p>
      </form>
    </>
  );
}
