'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { registerSchema, type RegisterInput, useRegister } from '@/features/auth';
import { Button } from '@/components/ui/button';

export default function RegisterPage() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterInput>({ resolver: zodResolver(registerSchema) });
  const { mutateAsync, isPending, error } = useRegister();

  async function onSubmit(values: RegisterInput) {
    await mutateAsync(values);
    router.push('/dashboard');
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mx-auto mt-20 flex w-80 flex-col gap-3">
      <h1 className="text-xl font-bold">Đăng ký</h1>
      <input className="rounded border p-2" placeholder="Tên" {...register('name')} />
      {errors.name && <span className="text-sm text-red-600">{errors.name.message}</span>}
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
        {isPending ? 'Đang xử lý...' : 'Đăng ký'}
      </Button>
      {error && <span className="text-sm text-red-600">{(error as Error).message}</span>}
      <p className="text-muted-foreground text-sm">
        Đã có tài khoản?{' '}
        <Link href="/login" className="underline">
          Đăng nhập
        </Link>
      </p>
    </form>
  );
}
