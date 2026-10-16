import { redirect } from 'next/navigation';
import { getSession } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await getSession())) redirect('/login');
  return <div className="mx-auto max-w-5xl p-6">{children}</div>;
}
