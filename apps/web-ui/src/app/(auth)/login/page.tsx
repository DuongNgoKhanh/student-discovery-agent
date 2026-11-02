import { Suspense } from 'react';
import { AuthShell } from '@/features/auth';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
