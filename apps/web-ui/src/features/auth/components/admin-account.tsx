'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { IconButton } from '@/components/shared/icon-button';
import { useLogout } from '../hooks/use-logout';

export function AdminAccount() {
  const router = useRouter();
  const logout = useLogout();
  return (
    <div className="flex items-center justify-between gap-2 px-2">
      <span className="truncate text-13 text-sidebar-foreground">Quản trị viên</span>
      <IconButton
        className="h-8 w-8" label="Đăng xuất" disabled={logout.isPending}
        onClick={() => logout.mutate(undefined, { onSettled: () => router.replace('/admin/login') })}
      >
        <LogOut className="h-4 w-4 text-muted-foreground" aria-hidden />
      </IconButton>
    </div>
  );
}
