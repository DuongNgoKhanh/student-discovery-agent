'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLogout } from '../hooks/use-logout';

export function AdminAccount() {
  const router = useRouter();
  const logout = useLogout();
  return (
    <div className="flex items-center justify-between gap-2 px-2">
      <span className="truncate text-13 text-sidebar-foreground">Quản trị viên</span>
      <Button
        variant="ghost" size="icon" className="h-8 w-8" aria-label="Đăng xuất" title="Đăng xuất" disabled={logout.isPending}
        onClick={() => logout.mutate(undefined, { onSettled: () => router.replace('/admin/login') })}
      >
        <LogOut className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  );
}
