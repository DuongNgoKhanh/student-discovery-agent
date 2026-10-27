'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, Database, Plus, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useKnowledgeBases } from '../hooks/use-knowledge';
import type { KnowledgeBase } from '../types';
import { CreateKnowledgeBaseDialog } from './create-knowledge-base-dialog';
import { fullDateTime, relativeTime } from './shared/format';
import { PageTitle } from './shared/page-title';
import { QueryState } from './shared/query-state';

const CARD = 'flex h-full min-h-[148px] flex-col gap-2 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function KnowledgeBaseCard({ kb }: { kb: KnowledgeBase }) {
  return (
    <Link href={`/admin/knowledge/${encodeURIComponent(kb.id)}/documents`} className={`${CARD} bg-card hover:border-primary/40 hover:shadow-sm`}>
      <span className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-subtle"><Database className="h-4 w-4 text-primary" aria-hidden /></span>
        <span className="truncate text-sm font-semibold">{kb.name}</span>
      </span>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {kb.document_count} tài liệu
        {kb.error_count > 0 && <span className="inline-flex items-center gap-1 text-destructive">· <AlertTriangle className="h-3 w-3" aria-hidden />{kb.error_count} lỗi index</span>}
      </span>
      <span className="line-clamp-2 text-13 text-muted-foreground">{kb.description || '—'}</span>
      <span className="mt-auto text-xs text-muted-foreground" title={fullDateTime(kb.updated_at)}>Cập nhật {relativeTime(kb.updated_at)}</span>
    </Link>
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
      <QueryState query={bases}>
        {data => {
          const visible = needle ? data.filter(kb => `${kb.name} ${kb.description}`.toLocaleLowerCase('vi').includes(needle)) : data;
          return (
            <>
              <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                <button type="button" onClick={() => setCreating(true)} className={`${CARD} border-dashed bg-sidebar hover:border-primary hover:bg-primary-subtle/50`}>
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
