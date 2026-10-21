import { redirect } from 'next/navigation';
import { SessionRecovery } from '@/features/auth/components/session-recovery';
import { SessionExpired, getSession } from '@/lib/api/session.server';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  try {
    if (!(await getSession())) redirect('/login');
  } catch (error) {
    if (error instanceof SessionExpired) return <SessionRecovery />;
    throw error;
  }
  return <div className="mx-auto max-w-5xl p-6">{children}</div>;
}
