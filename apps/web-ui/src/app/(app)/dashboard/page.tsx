'use client';

import { useMe } from '@/features/users';
import { PageHeader } from '@/components/shared/page-header';

export default function DashboardPage() {
  const { data, isLoading, error } = useMe();

  if (isLoading) return <p>Đang tải...</p>;
  if (error) return <p className="text-red-600">{(error as Error).message}</p>;

  return <PageHeader title={`Xin chào ${data?.name ?? data?.email ?? ''}`} />;
}
