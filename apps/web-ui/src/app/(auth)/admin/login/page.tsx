import { Suspense } from 'react';
import { AdminLoginForm } from '@/features/auth/components/admin-login-form';
import { StudioAuthShell } from '@/features/auth/components/studio-auth-shell';

export const metadata = { title: 'Đăng nhập · Agent Studio' };

export default function AdminLoginPage() {
  return (
    <StudioAuthShell>
      <Suspense fallback={null}>
        <AdminLoginForm />
      </Suspense>
    </StudioAuthShell>
  );
}
