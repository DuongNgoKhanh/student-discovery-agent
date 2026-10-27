'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Copy, MoreHorizontal, RotateCw, SearchX, Upload } from 'lucide-react';
import { IconButton } from '@/components/shared/icon-button';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils/cn';
import { isIndexPending, knowledgeKeys, useArchiveDocument, useDocuments, useRestoreDocument, useRetryRevision } from '../hooks/use-knowledge';
import type { DocumentFilters, DocumentSummary } from '../types';
import { kbHref } from './kb-routes';
import { copyText } from './shared/copy-button';
import { ConfirmDialog } from './shared/confirm-dialog';
import { EmptyState } from './shared/empty-state';
import { errorMessage } from './shared/error-message';
import { fullDateTime, relativeTime } from './shared/format';
import { IndexStatus } from './shared/index-status';
import { QueryState } from './shared/query-state';

export const PAGE_SIZE = 20;
const CONFLICT = 'Tài liệu vừa thay đổi, đã tải lại.';

const docHref = (kb: string, doc: string) => kbHref(kb, `documents/${encodeURIComponent(doc)}`);

/** Toasts the outcome; a 409 means the row is stale, so reload the list instead of showing a generic error. */
function useDocumentAction(kb: string) {
  const client = useQueryClient();
  return async (run: () => Promise<unknown>, success: string) => {
    try {
      await run();
      toast.success(success);
    } catch (error) {
      if (error instanceof ApiError && error.httpStatus === 409) {
        toast.error(CONFLICT);
        void client.invalidateQueries({ queryKey: knowledgeKeys.documents(kb) });
      } else {
        toast.error(errorMessage(error));
      }
    }
  };
}

function DocumentRow({ kb, doc, index }: { kb: string; doc: DocumentSummary; index: number }) {
  const archive = useArchiveDocument();
  const restore = useRestoreDocument();
  const retry = useRetryRevision();
  const act = useDocumentAction(kb);
  const [confirmOff, setConfirmOff] = useState(false);
  const failed = doc.index_status === 'error';
  const hint = isIndexPending(doc.index_status) && doc.active_revision ? `Agent vẫn dùng r${doc.active_revision}` : undefined;
  const archived = doc.status === 'archived';
  const busy = archive.isPending || restore.isPending;
  const href = docHref(kb, doc.id);

  const retryIndex = () => act(() => retry.mutateAsync({ kb, doc: doc.id, revision: doc.revision }), `Đang index lại "${doc.title}"`);
  const turnOff = () => act(() => archive.mutateAsync({ kb, doc: doc.id, expected_revision: doc.revision }), `Đã tắt "${doc.title}"`);
  const turnOn = () => act(() => restore.mutateAsync({ kb, doc: doc.id, expected_revision: doc.revision }), `Đã bật "${doc.title}"`);
  const copyId = async () => {
    if (await copyText(doc.id)) toast.success('Đã copy ID'); else toast.error('Không copy được ID.');
  };

  const dot = <IndexStatus status={doc.index_status} />;
  return (
    <TableRow className={cn('group', archived && 'text-muted-foreground opacity-70')}>
      <TableCell className="w-12 tabular-nums text-muted-foreground">{index}</TableCell>
      <TableCell className="max-w-0 min-w-48">
        <Link href={href} className="block truncate rounded-sm font-medium hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {doc.title}
        </Link>
        <span className="hidden truncate font-mono text-xs text-muted-foreground group-focus-within:block group-hover:block">{doc.id}</span>
      </TableCell>
      <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
        <Tooltip>
          <TooltipTrigger asChild><span tabIndex={0} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{relativeTime(doc.updated_at)}</span></TooltipTrigger>
          <TooltipContent>{fullDateTime(doc.updated_at)}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <span className="inline-flex items-center gap-2">
          {hint ? (
            <Tooltip>
              <TooltipTrigger asChild><span tabIndex={0} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{dot}</span></TooltipTrigger>
              <TooltipContent>{hint}</TooltipContent>
            </Tooltip>
          ) : dot}
          {failed && !archived && (
            <Button variant="ghost" size="sm" className="h-7 px-2" disabled={retry.isPending} onClick={() => void retryIndex()}>
              <RotateCw className="h-3.5 w-3.5" aria-hidden />Thử lại
            </Button>
          )}
        </span>
      </TableCell>
      <TableCell className="w-16">
        <Switch checked={!archived} disabled={busy} aria-label={`Bật tài liệu ${doc.title}`}
          onCheckedChange={on => { if (on) void turnOn(); else setConfirmOff(true); }} />
        <ConfirmDialog open={confirmOff} onOpenChange={setConfirmOff} title={`Tắt "${doc.title}"?`}
          description="Agent sẽ không tìm thấy tài liệu này nữa. Bật lại bất cứ lúc nào." confirmLabel="Tắt" destructive onConfirm={turnOff} />
      </TableCell>
      <TableCell className="w-12 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton className="h-8 w-8" label={`Thao tác cho ${doc.title}`} tooltip="Thao tác">
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild><Link href={href}><ExternalLink aria-hidden />Mở</Link></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copyId()}><Copy aria-hidden />Copy ID</DropdownMenuItem>
            {failed && <DropdownMenuItem onSelect={() => void retryIndex()}><RotateCw aria-hidden />Thử index lại</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}

function DocumentsHeader() {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead className="w-12">#</TableHead>
        <TableHead>Tên</TableHead>
        <TableHead className="hidden md:table-cell">Cập nhật</TableHead>
        <TableHead>Trạng thái</TableHead>
        <TableHead>Bật</TableHead>
        <TableHead className="w-12"><span className="sr-only">Thao tác</span></TableHead>
      </TableRow>
    </TableHeader>
  );
}

const Frame = ({ children }: { children: React.ReactNode }) => <div className="overflow-x-auto rounded-xl border">{children}</div>;

const loadingRows = (
  <Frame>
    <Table aria-busy="true" aria-label="Đang tải tài liệu">
      <DocumentsHeader />
      <TableBody>
        {Array.from({ length: 5 }, (_, row) => (
          <TableRow key={row}>{Array.from({ length: 6 }, (_, cell) => (
            <TableCell key={cell} className={cn(cell === 2 && 'hidden md:table-cell')}><Skeleton className="h-4 w-full max-w-40" /></TableCell>
          ))}</TableRow>
        ))}
      </TableBody>
    </Table>
  </Frame>
);

export interface DocumentsTableProps {
  kb: string;
  filters: DocumentFilters;
  isFiltered: boolean;
  onClearFilters: () => void;
}

/** Remount (via `key`) when filters change so paging restarts at the first page. */
export function DocumentsTable({ kb, filters, isFiltered, onClearFilters }: DocumentsTableProps) {
  // Cursor of each visited page; the first page has none.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const page = cursors.length - 1;
  const query = useDocuments(kb, { ...filters, cursor: cursors[page], limit: PAGE_SIZE }, { pollWhilePending: true });

  const empty = isFiltered ? (
    <EmptyState icon={SearchX} title="Không tìm thấy tài liệu" description="Thử từ khoá hoặc trạng thái khác."
      action={<Button variant="outline" onClick={onClearFilters}>Xoá bộ lọc</Button>} />
  ) : (
    <EmptyState icon={FileText} title="Chưa có tài liệu" description="Nhập file CSV, Markdown hoặc văn bản để agent có thể tra cứu."
      action={<Button asChild><Link href={kbHref(kb, 'documents/import')}><Upload className="h-4 w-4" aria-hidden />Nhập file</Link></Button>} />
  );

  return (
    <QueryState query={query} loading={loadingRows} isEmpty={data => data.items.length === 0 && page === 0}
      empty={<div className="rounded-xl border">{empty}</div>}>
      {data => (
        <div className="space-y-3">
          <Frame>
            <Table>
              <DocumentsHeader />
              <TableBody>
                {data.items.map((doc, row) => <DocumentRow key={doc.id} kb={kb} doc={doc} index={page * PAGE_SIZE + row + 1} />)}
              </TableBody>
            </Table>
          </Frame>
          {(page > 0 || data.next_cursor) && (
            <nav aria-label="Phân trang tài liệu" className="flex items-center justify-end gap-2 text-13 text-muted-foreground">
              <span>Trang {page + 1}</span>
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setCursors(stack => stack.slice(0, -1))}>
                <ChevronLeft className="h-4 w-4" aria-hidden />Trước
              </Button>
              <Button variant="outline" size="sm" disabled={!data.next_cursor}
                onClick={() => setCursors(stack => [...stack, data.next_cursor ?? undefined])}>
                Sau<ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </nav>
          )}
        </div>
      )}
    </QueryState>
  );
}
