'use client';

import { useAdminUsers } from '@/features/users';

export default function AdminUsersPage() {
  const { data, isLoading, error } = useAdminUsers();

  if (isLoading) return <p>Đang tải...</p>;
  if (error) return <p className="text-red-600">{(error as Error).message}</p>;

  return (
    <ul className="list-disc pl-5">
      {data?.map((u) => <li key={u.id}>{u.email}</li>)}
    </ul>
  );
}
