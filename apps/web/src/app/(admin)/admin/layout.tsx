import { redirect } from 'next/navigation';
import { getSession } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.isAdmin) redirect('/admin/login');
  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-4 font-bold">Khu vực Admin</header>
      {children}
    </div>
  );
}
