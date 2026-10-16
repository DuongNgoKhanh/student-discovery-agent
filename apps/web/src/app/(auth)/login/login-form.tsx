'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { loginSchema, type LoginInput, useLogin } from '@/features/auth';
import { safeNext } from '@/lib/auth/safe-next';
import { Button } from '@/components/ui/button';

export function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });
  const { mutateAsync, isPending, error } = useLogin();

  async function onSubmit(values: LoginInput) {
    await mutateAsync(values);
    router.push(next);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mx-auto mt-20 flex w-80 flex-col gap-3">
      <h1 className="text-xl font-bold">Đăng nhập</h1>
      <input className="rounded border p-2" placeholder="Email" {...register('email')} />
      {errors.email && <span className="text-sm text-red-600">{errors.email.message}</span>}
      <input
        className="rounded border p-2"
        type="password"
        placeholder="Mật khẩu"
        {...register('password')}
      />
      {errors.password && <span className="text-sm text-red-600">{errors.password.message}</span>}
      <Button type="submit" disabled={isPending}>
        {isPending ? 'Đang xử lý...' : 'Đăng nhập'}
      </Button>
      {error && <span className="text-sm text-red-600">{(error as Error).message}</span>}
      <p className="text-muted-foreground text-sm">
        Chưa có tài khoản?{' '}
        <Link href="/register" className="underline">
          Đăng ký
        </Link>
      </p>
    </form>
  );
}
