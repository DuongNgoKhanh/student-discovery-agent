'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { adminLoginSchema, type AdminLoginInput } from '../schemas/auth';
import { useAdminLogin } from '../hooks/use-admin-login';
import { Button } from '@/components/ui/button';

export function AdminLoginForm() {
  const router = useRouter();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AdminLoginInput>({ resolver: zodResolver(adminLoginSchema) });
  const { mutateAsync, isPending, error } = useAdminLogin();

  async function onSubmit(values: AdminLoginInput) {
    await mutateAsync(values);
    router.push('/admin');
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="mx-auto mt-20 flex w-80 flex-col gap-3">
      <h1 className="text-xl font-bold">Đăng nhập Admin</h1>
      <input className="rounded border p-2" placeholder="Tên đăng nhập" {...register('username')} />
      {errors.username && <span className="text-sm text-red-600">{errors.username.message}</span>}
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
    </form>
  );
}
