import { redirect } from 'next/navigation';
import { SessionExpired, getSession } from '@/lib/api/session.server';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession().catch(error => {
    if (error instanceof SessionExpired) redirect('/admin/login');
    throw error;
  });
  if (!session?.is_admin) redirect('/admin/login');
  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-4 font-bold">Khu vực Admin</header>
      {children}
    </div>
  );
}
