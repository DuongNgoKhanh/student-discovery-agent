'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Database, Menu, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils/cn';

const NAV = [
  { href: '/admin/knowledge', label: 'Knowledge', icon: Database, match: (path: string) => path.startsWith('/admin/knowledge') },
  { href: '/admin', label: 'Người dùng', icon: Users, match: (path: string) => path === '/admin' },
] as const;

// Pages inside one knowledge base bring their own second sidebar and run edge to edge.
const isFlush = (path: string) => /^\/admin\/knowledge\/[^/]+/.test(path);

export interface AdminShellProps {
  children: React.ReactNode;
  account?: React.ReactNode;
}

function SidebarBody({ pathname, account, onNavigate }: { pathname: string; account?: React.ReactNode; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-4 px-3 py-4">
      <Link href="/admin/knowledge" onClick={onNavigate} className="rounded-md px-2 text-base font-semibold text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        IHRD Studio
      </Link>
      <nav aria-label="Điều hướng chính" className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-8 items-center gap-2 rounded-md px-2 text-13 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'bg-primary-subtle font-medium text-primary' : 'text-sidebar-foreground hover:bg-accent',
              )}
            >
              <Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
      {account && <div className="mt-auto border-t pt-3">{account}</div>}
    </div>
  );
}

export function AdminShell({ children, account }: AdminShellProps) {
  const pathname = usePathname() ?? '';
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-[200px] shrink-0 border-r bg-sidebar md:block">
        <SidebarBody pathname={pathname} account={account} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-2 border-b bg-sidebar px-3 md:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Mở menu"><Menu className="h-4 w-4" /></Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[240px] bg-sidebar p-0">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SidebarBody pathname={pathname} account={account} onNavigate={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="text-sm font-semibold text-brand">IHRD Studio</span>
        </header>
        <main className={cn('min-w-0 flex-1', !isFlush(pathname) && 'p-4 md:p-6')}>{children}</main>
      </div>
    </div>
  );
}
