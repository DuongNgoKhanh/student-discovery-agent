'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ChevronDown, Database, FileText, Settings, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import { useKnowledgeBase } from '../hooks/use-knowledge';

export const KB_SECTIONS = [
  { slug: 'documents', label: 'Tài liệu', icon: FileText },
  { slug: 'testing', label: 'Thử truy xuất', icon: Target },
  { slug: 'settings', label: 'Cài đặt', icon: Settings },
] as const;
export type KnowledgeBaseSection = (typeof KB_SECTIONS)[number]['slug'];

export const kbHref = (kb: string, path = '') => `/admin/knowledge/${encodeURIComponent(kb)}${path ? `/${path}` : ''}`;

/** The section is the first path segment after /admin/knowledge/[kb]; the document editor belongs to "documents". */
export function activeSection(pathname: string): KnowledgeBaseSection | undefined {
  const segment = pathname.split('/')[4];
  return KB_SECTIONS.find(section => section.slug === segment)?.slug;
}

export interface KnowledgeBaseShellProps {
  kb: string;
  children: React.ReactNode;
}

export function KnowledgeBaseShell({ kb, children }: KnowledgeBaseShellProps) {
  const pathname = usePathname() ?? '';
  const base = useKnowledgeBase(kb);
  const active = activeSection(pathname);
  const name = base.data?.name ?? kb;
  const errors = base.data?.error_count ?? 0;
  const current = KB_SECTIONS.find(section => section.slug === active) ?? KB_SECTIONS[0];

  const errorLink = errors > 0 && (
    <Link href={`${kbHref(kb, 'documents')}?state=error`}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-13 text-destructive hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <AlertTriangle className="h-4 w-4" aria-hidden />{errors} lỗi index
    </Link>
  );

  return (
    <div className="flex flex-col md:min-h-screen md:flex-row">
      <aside aria-label="Knowledge base" className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col gap-4 border-r bg-sidebar px-3 py-4 md:flex">
        <Link href="/admin/knowledge" className="inline-flex items-center gap-1 rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />Knowledge
        </Link>
        <div className="flex items-center gap-2 px-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-subtle"><Database className="h-4 w-4 text-primary" aria-hidden /></span>
          <div className="min-w-0">
            {base.isLoading ? <Skeleton className="h-4 w-28" /> : (
              <Tooltip>
                <TooltipTrigger asChild><p className="truncate text-sm font-semibold" tabIndex={0}>{name}</p></TooltipTrigger>
                <TooltipContent side="right">{name}</TooltipContent>
              </Tooltip>
            )}
            {base.data && <p className="text-xs text-muted-foreground">{base.data.document_count} tài liệu</p>}
          </div>
        </div>
        <nav aria-label="Mục của knowledge base" className="flex flex-col gap-0.5">
          {KB_SECTIONS.map(({ slug, label, icon: Icon }) => {
            const selected = slug === active;
            return (
              <Link key={slug} href={kbHref(kb, slug)} aria-current={selected ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md px-2 text-13 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected ? 'bg-primary-subtle font-medium text-primary' : 'text-sidebar-foreground hover:bg-accent',
                )}>
                <Icon className={cn('h-4 w-4', selected ? 'text-primary' : 'text-muted-foreground')} aria-hidden />{label}
              </Link>
            );
          })}
        </nav>
        {errorLink && <div className="mt-auto">{errorLink}</div>}
      </aside>

      <div className="flex items-center justify-between gap-2 border-b px-4 py-2 md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="min-w-0 justify-start px-2" aria-label={`${name}: ${current.label}. Đổi mục`}>
              <Database className="h-4 w-4 text-primary" aria-hidden />
              <span className="truncate font-semibold">{name}</span>
              <span className="text-muted-foreground">· {current.label}</span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {KB_SECTIONS.map(({ slug, label, icon: Icon }) => (
              <DropdownMenuItem key={slug} asChild className={cn(slug === active && 'text-primary')}>
                <Link href={kbHref(kb, slug)} aria-current={slug === active ? 'page' : undefined}><Icon aria-hidden />{label}</Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem asChild><Link href="/admin/knowledge"><ArrowLeft aria-hidden />Tất cả knowledge</Link></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {errorLink}
      </div>

      <div className="min-w-0 flex-1 p-4 md:p-6">{children}</div>
    </div>
  );
}
