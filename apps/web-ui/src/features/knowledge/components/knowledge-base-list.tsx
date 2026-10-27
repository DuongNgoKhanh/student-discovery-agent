'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, Database, MoreHorizontal, Pencil, Plus, Search, Settings } from 'lucide-react';
import { IconButton } from '@/components/shared/icon-button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import { useKnowledgeBases } from '../hooks/use-knowledge';
import type { KnowledgeBase } from '../types';
import { CreateKnowledgeBaseDialog } from './create-knowledge-base-dialog';
import { kbHref } from './kb-routes';
import { RenameKnowledgeBaseDialog } from './rename-knowledge-base-dialog';
import { fullDateTime, relativeTime } from './shared/format';
import { PageTitle } from './shared/page-title';
import { QueryState } from './shared/query-state';

const CARD = 'flex h-full min-h-[156px] flex-col gap-2 rounded-xl border p-4 text-left transition-colors';
const GRID = 'grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** The name link stretches over the card; the error link and the menu sit above it, so no link is nested. */
function KnowledgeBaseCard({ kb }: { kb: KnowledgeBase }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div className={cn(CARD, 'relative bg-card hover:border-primary/40 hover:shadow-sm focus-within:border-primary/40')}>
      <div className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-subtle"><Database className="h-4 w-4 text-primary" aria-hidden /></span>
        <Link href={kbHref(kb.id, 'documents')}
          className={cn('min-w-0 flex-1 self-center truncate rounded-sm text-sm font-semibold after:absolute after:inset-0 after:rounded-xl after:content-[""]', FOCUS)}>
          {kb.name}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton className="relative z-10 -mr-1.5 -mt-1 h-8 w-8" label={`Thao tác cho ${kb.name}`} tooltip="Thao tác">
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenaming(true)}><Pencil aria-hidden />Đổi tên</DropdownMenuItem>
            <DropdownMenuItem asChild><Link href={kbHref(kb.id, 'settings')}><Settings aria-hidden />Cài đặt</Link></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="line-clamp-2 text-13 text-muted-foreground">{kb.description || 'Chưa có mô tả.'}</p>
      <div className="mt-auto flex flex-col gap-1 text-xs text-muted-foreground">
        <span>{kb.document_count} tài liệu</span>
        {kb.error_count > 0 && (
          <Link href={`${kbHref(kb.id, 'documents')}?state=error`}
            className={cn('relative z-10 inline-flex w-fit items-center gap-1 rounded-sm text-warning-foreground hover:underline', FOCUS)}>
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />{kb.error_count} tài liệu lỗi index
          </Link>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className={cn('relative z-10 w-fit rounded-sm', FOCUS)}>Cập nhật {relativeTime(kb.updated_at)}</span>
          </TooltipTrigger>
          <TooltipContent>{fullDateTime(kb.updated_at)}</TooltipContent>
        </Tooltip>
      </div>
      <RenameKnowledgeBaseDialog kb={kb} open={renaming} onOpenChange={setRenaming} />
    </div>
  );
}

export function KnowledgeBaseList() {
  const bases = useKnowledgeBases();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLocaleLowerCase('vi');
  return (
    <>
      <PageTitle
        title="Knowledge"
        description="Tài liệu để agent tra cứu khi trả lời."
        actions={!!bases.data?.length && (
          <div className="relative w-56">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input type="search" aria-label="Tìm knowledge base" placeholder="Tìm…" className="pl-8" value={filter} onChange={e => setFilter(e.target.value)} />
          </div>
        )}
      />
      <QueryState query={bases} loading={(
        <div aria-busy="true" aria-label="Đang tải knowledge base" className={GRID}>
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-[156px] rounded-xl" />)}
        </div>
      )}>
        {data => {
          const visible = needle ? data.filter(kb => `${kb.name} ${kb.description}`.toLocaleLowerCase('vi').includes(needle)) : data;
          return (
            <>
              <div className={GRID}>
                <button type="button" onClick={() => setCreating(true)} className={cn(CARD, FOCUS, 'items-start justify-center border-dashed bg-card hover:border-primary hover:bg-primary-subtle/50')}>
                  <Plus className="h-5 w-5 text-primary" aria-hidden />
                  <span className="text-sm font-semibold">Tạo knowledge base</span>
                  <span className="text-13 text-muted-foreground">Nhập tài liệu để agent tra cứu</span>
                </button>
                {visible.map(kb => <KnowledgeBaseCard key={kb.id} kb={kb} />)}
              </div>
              {data.length === 0 && <p className="mt-4 text-13 text-muted-foreground">Chưa có knowledge base nào. Tạo một cái rồi nhập tài liệu vào để agent dùng.</p>}
              {data.length > 0 && visible.length === 0 && <p className="mt-4 text-13 text-muted-foreground">Không có knowledge base nào khớp “{filter.trim()}”.</p>}
            </>
          );
        }}
      </QueryState>
      <CreateKnowledgeBaseDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
