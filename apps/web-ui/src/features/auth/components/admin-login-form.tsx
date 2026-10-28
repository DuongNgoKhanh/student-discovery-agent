'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { adminLoginSchema, type AdminLoginInput } from '../schemas/auth';
import { useAdminLogin } from '../hooks/use-admin-login';
import { AuthPasswordField, AuthTextField } from './auth-fields';
import { ApiError } from '@/lib/api/errors';
import { mapErrorMessage } from '@/lib/api/error-map';
import { safeNext } from '@/lib/auth/safe-next';
import { Button } from '@/components/ui/button';

// Ô nhập dùng token Studio thay cho màu thương hiệu của trang học sinh.
const studioInput =
  'rounded-lg border-input bg-card text-foreground focus:border-primary focus:ring-ring/20';

/** Chỉ quay lại trang trong khu vực admin; mọi đích khác về trang chủ Studio. */
export function adminNext(next: string | null): string {
  const path = safeNext(next, '/admin');
  const inAdmin = path === '/admin' || path.startsWith('/admin/') || path.startsWith('/admin?');
  return inAdmin && !path.startsWith('/admin/login') ? path : '/admin';
}

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.httpStatus === 401) return mapErrorMessage('AUTH_INVALID_CREDENTIALS');
    if (error.httpStatus === 429) return mapErrorMessage('RATE_LIMITED');
    if (error.httpStatus >= 500) return mapErrorMessage('SERVICE_UNAVAILABLE');
    return mapErrorMessage(error.code);
  }
  return 'Không kết nối được máy chủ, vui lòng thử lại.';
}

export function AdminLoginForm() {
  const router = useRouter();
  const next = adminNext(useSearchParams().get('next'));
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AdminLoginInput>({ resolver: zodResolver(adminLoginSchema) });
  const { mutateAsync, isPending, error } = useAdminLogin();

  async function onSubmit(values: AdminLoginInput) {
    try {
      await mutateAsync(values);
    } catch {
      return; // Lỗi đã hiển thị qua `error` của mutation.
    }
    // replace: nút Back không đưa admin quay lại form đăng nhập.
    router.replace(next);
    router.refresh();
  }

  return (
    <>
      <div className="mb-6 space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Đăng nhập Studio</h1>
        <p className="text-13 text-muted-foreground">
          Dành cho quản trị viên quản lý tri thức và cấu hình agent.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
        <AuthTextField
          id="username"
          label="Tên đăng nhập"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          className={studioInput}
          error={errors.username?.message}
          {...register('username')}
        />
        <AuthPasswordField
          id="password"
          label="Mật khẩu"
          autoComplete="current-password"
          className={studioInput}
          error={errors.password?.message}
          {...register('password')}
        />

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/20 bg-destructive-subtle px-3 py-2 text-13 text-destructive"
          >
            {loginErrorMessage(error)}
          </div>
        )}

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {isPending ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </Button>
      </form>
    </>
  );
}
