import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/shared/admin-shell';
import { AdminAccount } from '@/features/auth';
import { KnowledgeBaseNav } from '@/features/knowledge';
import { SessionExpired, getSession } from '@/lib/api/session.server';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession().catch(error => {
    if (error instanceof SessionExpired) redirect('/admin/login');
    throw error;
  });
  if (!session?.is_admin) redirect('/admin/login');
  return <AdminShell account={<AdminAccount />} knowledgeNav={<KnowledgeBaseNav />}>{children}</AdminShell>;
}
