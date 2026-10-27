'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { ChevronRight, CircleAlert } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import { useKnowledgeBase } from '../hooks/use-knowledge';
import { activeSection, KB_SECTIONS, kbHref } from './kb-routes';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** The KB id from the URL; only routes under /admin/knowledge/[kb] have one. */
function useCurrentKb(): string | undefined {
  const params = useParams<{ kb?: string }>();
  const pathname = usePathname() ?? '';
  const raw = params?.kb;
  return raw && pathname.startsWith('/admin/knowledge/') ? decodeURIComponent(raw) : undefined;
}

function KnowledgeBaseGroup({ kb }: { kb: string }) {
  const pathname = usePathname() ?? '';
  const base = useKnowledgeBase(kb);
  const active = activeSection(pathname);
  const name = base.data?.name ?? kb;
  const errors = base.data?.error_count ?? 0;
  return (
    <div className="ml-4 mt-1 flex flex-col gap-0.5 border-l pl-2">
      {base.isLoading ? <Skeleton className="mx-2 my-1.5 h-4 w-28" /> : (
        <Tooltip>
          <TooltipTrigger asChild>
            <p tabIndex={0} className={cn('truncate rounded-sm px-2 py-1 text-xs font-semibold text-foreground', FOCUS)}>{name}</p>
          </TooltipTrigger>
          <TooltipContent side="right">{name}</TooltipContent>
        </Tooltip>
      )}
      <ul aria-label={`Mục của ${name}`} className="flex flex-col gap-0.5">
        {KB_SECTIONS.map(({ slug, label, icon: Icon }) => {
          const selected = slug === active;
          return (
            <li key={slug}>
              <Link href={kbHref(kb, slug)} aria-current={selected ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md px-2 text-13 transition-colors', FOCUS,
                  selected ? 'bg-primary-subtle font-medium text-primary' : 'text-sidebar-foreground hover:bg-primary-subtle',
                )}>
                <Icon className={cn('h-4 w-4', selected ? 'text-primary' : 'text-muted-foreground')} aria-hidden />{label}
              </Link>
            </li>
          );
        })}
        {errors > 0 && (
          <li>
            <Link href={`${kbHref(kb, 'documents')}?state=error`}
              className={cn('flex h-8 items-center gap-2 rounded-md px-2 text-13 text-destructive hover:bg-destructive-subtle', FOCUS)}>
              <CircleAlert className="h-4 w-4" aria-hidden />{errors} lỗi index
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}

/** Nested sidebar group for the knowledge base in the URL; renders nothing outside one. */
export function KnowledgeBaseNav() {
  const kb = useCurrentKb();
  return kb ? <KnowledgeBaseGroup kb={kb} /> : null;
}

/** `Knowledge / {KB} / {Mục}` above the content of every page inside a knowledge base. */
export function KnowledgeBaseBreadcrumb({ kb }: { kb: string }) {
  const pathname = usePathname() ?? '';
  const base = useKnowledgeBase(kb);
  const section = KB_SECTIONS.find(item => item.slug === activeSection(pathname));
  // Deeper pages (editor, import) link back to their section instead of marking it current.
  const deeper = pathname.split('/').filter(Boolean).length > 4;
  const linkClass = cn('rounded-sm hover:text-foreground hover:underline', FOCUS);
  const separator = <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />;
  return (
    <nav aria-label="Breadcrumb" className="mb-3 min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <li className="shrink-0"><Link href="/admin/knowledge" className={linkClass}>Knowledge</Link></li>
        <li className="flex min-w-0 items-center gap-1">
          {separator}
          {base.isLoading ? <Skeleton className="h-3.5 w-24" /> : (
            <Link href={kbHref(kb, 'documents')} className={cn('truncate', linkClass)} aria-current={section ? undefined : 'page'}>
              {base.data?.name ?? kb}
            </Link>
          )}
        </li>
        {section && (
          <li className="flex shrink-0 items-center gap-1">
            {separator}
            {deeper
              ? <Link href={kbHref(kb, section.slug)} className={linkClass}>{section.label}</Link>
              : <span aria-current="page" className="font-medium text-foreground">{section.label}</span>}
          </li>
        )}
      </ol>
    </nav>
  );
}
