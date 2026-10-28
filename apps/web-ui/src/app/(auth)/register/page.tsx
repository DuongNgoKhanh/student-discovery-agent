import { Suspense } from 'react';
import { AuthShell } from '@/features/auth';
import { RegisterForm } from './register-form';

export default function RegisterPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
