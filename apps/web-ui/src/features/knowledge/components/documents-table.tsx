'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FilePlus, FileText, Info, Loader2, SearchX, Upload } from 'lucide-react';
import { IconButton } from '@/components/shared/icon-button';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils/cn';
import { isIndexPending, knowledgeKeys, useArchiveDocument, useDocuments, useRestoreDocument, useRetryRevision } from '../hooks/use-knowledge';
import type { DocumentFilters, DocumentSummary } from '../types';
import { DocumentRowMenu } from './documents-row-menu';
import { kbHref } from './kb-routes';
import { ConfirmDialog } from './shared/confirm-dialog';
import { EmptyState } from './shared/empty-state';
import { errorMessage } from './shared/error-message';
import { fullDateTime, relativeTime } from './shared/format';
import { INDEX_STATUS_LABELS, IndexStatus, type IndexStatus as IndexState } from './shared/index-status';
import { QueryState } from './shared/query-state';

export const PAGE_SIZE = 20;
const CONFLICT = 'Tài liệu vừa thay đổi, đã tải lại.';

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

const focusRing = 'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export type OpenDocument = (docId: string, focus?: 'error') => void;

function StatusCell({ doc, onOpen }: { doc: DocumentSummary; onOpen: OpenDocument }) {
  if (doc.index_status === 'error') {
    return (
      <button type="button" onClick={() => onOpen(doc.id, 'error')} aria-label={`Lỗi index: xem lỗi của ${doc.title}`}
        className={cn('-mx-1 px-1 py-0.5 hover:bg-destructive-subtle', focusRing)}>
        <IndexStatus status="error" />
      </button>
    );
  }
  const dot = <IndexStatus status={doc.index_status} />;
  // While a newer revision is queued or indexing, the agent keeps answering from the active one.
  const stale = isIndexPending(doc.index_status) && !!doc.active_revision && doc.active_revision < doc.revision;
  if (!stale) return dot;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span tabIndex={0} className={focusRing}>{dot}</span></TooltipTrigger>
      <TooltipContent>Agent vẫn dùng r{doc.active_revision}</TooltipContent>
    </Tooltip>
  );
}

function DocumentRow({ kb, doc, index, onOpen }: { kb: string; doc: DocumentSummary; index: number; onOpen: OpenDocument }) {
  const archive = useArchiveDocument();
  const restore = useRestoreDocument();
  const retry = useRetryRevision();
  const act = useDocumentAction(kb);
  const [confirmOff, setConfirmOff] = useState(false);
  const archived = doc.status === 'archived';
  const busy = archive.isPending || restore.isPending;

  const retryIndex = () => act(() => retry.mutateAsync({ kb, doc: doc.id, revision: doc.revision }), `Đang index lại "${doc.title}"`);
  const turnOff = () => act(() => archive.mutateAsync({ kb, doc: doc.id, expected_revision: doc.revision }), `Đã tắt truy xuất "${doc.title}"`);
  const turnOn = () => act(() => restore.mutateAsync({ kb, doc: doc.id, expected_revision: doc.revision }), `Đã bật truy xuất "${doc.title}"`);

  return (
    <TableRow className={cn(archived && 'text-muted-foreground opacity-70')}>
      <TableCell className="w-12 tabular-nums text-muted-foreground">{index}</TableCell>
      <TableCell className="max-w-0 min-w-48 py-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" onClick={() => onOpen(doc.id)}
              className={cn('block max-w-full truncate text-left font-medium hover:text-primary hover:underline', focusRing)}>
              {doc.title}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start" className="max-w-sm">
            <span className="block break-words font-medium">{doc.title}</span>
            <span className="block text-xs opacity-80">Bấm để xem chi tiết</span>
          </TooltipContent>
        </Tooltip>
        <span className="block truncate font-mono text-xs leading-tight text-muted-foreground">{doc.id}</span>
      </TableCell>
      <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
        <Tooltip>
          <TooltipTrigger asChild><span tabIndex={0} className={focusRing}>{relativeTime(doc.updated_at)}</span></TooltipTrigger>
          <TooltipContent>{fullDateTime(doc.updated_at)}</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="whitespace-nowrap"><StatusCell doc={doc} onOpen={onOpen} /></TableCell>
      <TableCell>
        <Tooltip>
          {/* The trigger sets its own data-state, which would clobber the switch's checked styling, so a wrapper carries it. */}
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Switch checked={!archived} disabled={busy} aria-label={`Cho phép truy xuất: ${doc.title}`}
                onCheckedChange={on => { if (on) void turnOn(); else setConfirmOff(true); }} />
            </span>
          </TooltipTrigger>
          <TooltipContent>{archived ? 'Agent đang không truy xuất tài liệu này. Bấm để bật lại.' : 'Agent đang truy xuất tài liệu này. Bấm để tắt.'}</TooltipContent>
        </Tooltip>
        <ConfirmDialog open={confirmOff} onOpenChange={setConfirmOff} title={`Tắt truy xuất "${doc.title}"?`}
          description="Agent sẽ không truy xuất tài liệu này nữa. Dữ liệu không bị xoá." confirmLabel="Tắt truy xuất" destructive onConfirm={turnOff} />
      </TableCell>
      <TableCell className="w-12 text-right">
        <DocumentRowMenu kb={kb} doc={doc} onOpen={focus => onOpen(doc.id, focus)} onRetry={() => void retryIndex()} retrying={retry.isPending} />
      </TableCell>
    </TableRow>
  );
}

const STATUS_HELP: [IndexState, string][] = [
  ['pending', 'bản mới đang chờ đến lượt index.'],
  ['indexing', 'đang tách đoạn và tạo embedding.'],
  ['ready', 'agent truy xuất được bản mới nhất.'],
  ['error', 'index thất bại; bấm vào để xem lỗi và thử lại.'],
];

function StatusHelp() {
  return (
    <span className="block max-w-72 space-y-1">
      <span className="block">Trạng thái của bản mới nhất. Khi bản mới chưa sẵn sàng, agent vẫn dùng bản cũ.</span>
      {STATUS_HELP.map(([status, text]) => (
        <span key={status} className="block"><span className="font-medium">{INDEX_STATUS_LABELS[status]}</span>: {text}</span>
      ))}
    </span>
  );
}

export const RETRIEVAL_HELP = 'Bật/tắt chỉ quyết định agent có truy xuất tài liệu này hay không. Tắt không xoá dữ liệu, bật lại dùng được ngay.';

function DocumentsHeader() {
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead className="w-12">#</TableHead>
        <TableHead>Tên</TableHead>
        <TableHead className="hidden md:table-cell">Cập nhật</TableHead>
        <TableHead className="whitespace-nowrap">
          <span className="inline-flex items-center gap-0.5">
            Trạng thái index
            <IconButton className="h-6 w-6 text-muted-foreground" label="Giải thích: Trạng thái index" tooltip={<StatusHelp />}>
              <Info className="h-3.5 w-3.5" aria-hidden />
            </IconButton>
          </span>
        </TableHead>
        <TableHead className="whitespace-nowrap">
          <span className="inline-flex items-center gap-0.5">
            Cho phép truy xuất
            <IconButton className="h-6 w-6 text-muted-foreground" label="Giải thích: Cho phép truy xuất" tooltip={<span className="block max-w-64">{RETRIEVAL_HELP}</span>}>
              <Info className="h-3.5 w-3.5" aria-hidden />
            </IconButton>
          </span>
        </TableHead>
        <TableHead className="w-12"><span className="sr-only">Thao tác</span></TableHead>
      </TableRow>
    </TableHeader>
  );
}

const Frame = ({ children }: { children: React.ReactNode }) => <div className="overflow-x-auto rounded-xl border">{children}</div>;

// One skeleton per column, shaped like what loads there: number, title + id, date, status, switch, menu.
const SKELETON_CELLS = [
  <Skeleton key="n" className="h-4 w-4" />,
  <span key="t" className="block space-y-1.5"><Skeleton className="h-4 w-48 max-w-full" /><Skeleton className="h-3 w-28" /></span>,
  <Skeleton key="d" className="h-4 w-20" />,
  <Skeleton key="s" className="h-4 w-24" />,
  <Skeleton key="w" className="h-5 w-9 rounded-full" />,
  <Skeleton key="m" className="ml-auto h-6 w-6" />,
];

const loadingRows = (
  <Frame>
    <Table aria-busy="true" aria-label="Đang tải tài liệu">
      <DocumentsHeader />
      <TableBody>
        {Array.from({ length: 5 }, (_, row) => (
          <TableRow key={row} className="hover:bg-transparent">{SKELETON_CELLS.map((cell, index) => (
            <TableCell key={index} className={cn(index === 2 && 'hidden md:table-cell')}>{cell}</TableCell>
          ))}</TableRow>
        ))}
      </TableBody>
    </Table>
  </Frame>
);

export interface DocumentsTableProps {
  kb: string;
  /** Opens the shared detail sheet; `'error'` jumps to the latest index error. */
  onOpenDocument: OpenDocument;
  filters: DocumentFilters;
  isFiltered: boolean;
  onClearFilters: () => void;
}

/** Remount (via `key`) when filters change so paging restarts at the first page. */
export function DocumentsTable({ kb, onOpenDocument, filters, isFiltered, onClearFilters }: DocumentsTableProps) {
  // Cursor of each visited page; the first page has none.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const page = cursors.length - 1;
  const query = useDocuments(kb, { ...filters, cursor: cursors[page], limit: PAGE_SIZE }, { pollWhilePending: true, keepPrevious: true });
  // The previous page stays visible (dimmed) while the requested one loads.
  const turning = query.isPlaceholderData;

  const empty = isFiltered ? (
    <EmptyState icon={SearchX} title="Không tìm thấy tài liệu" description="Thử từ khoá hoặc trạng thái khác."
      action={<Button variant="outline" onClick={onClearFilters}>Xoá bộ lọc</Button>} />
  ) : (
    <EmptyState icon={FileText} title="Chưa có tài liệu" description="Nhập file CSV, Markdown hoặc văn bản để agent có thể tra cứu."
      action={(
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild><Link href={kbHref(kb, 'documents/import')}><Upload className="h-4 w-4" aria-hidden />Nhập file</Link></Button>
          <Button asChild variant="outline"><Link href={kbHref(kb, 'documents/new')}><FilePlus className="h-4 w-4" aria-hidden />Soạn mới</Link></Button>
        </div>
      )} />
  );

  return (
    <QueryState query={query} loading={loadingRows} isEmpty={data => data.items.length === 0 && page === 0}
      empty={<div className="rounded-xl border">{empty}</div>}>
      {data => (
        <div className="space-y-3">
          <Frame>
            <Table aria-busy={turning} className={cn('transition-opacity motion-reduce:transition-none', turning && 'pointer-events-none opacity-60')}>
              <DocumentsHeader />
              <TableBody>
                {data.items.map((doc, row) => <DocumentRow key={doc.id} kb={kb} doc={doc} index={page * PAGE_SIZE + row + 1} onOpen={onOpenDocument} />)}
              </TableBody>
            </Table>
          </Frame>
          {(page > 0 || data.next_cursor) && (
            <nav aria-label="Phân trang tài liệu" className="flex items-center justify-end gap-2 text-13 text-muted-foreground">
              {turning
                ? <span role="status" className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />Đang tải…</span>
                : <span>Trang {page + 1}</span>}
              <Button variant="outline" size="sm" disabled={page === 0 || turning} onClick={() => setCursors(stack => stack.slice(0, -1))}>
                <ChevronLeft className="h-4 w-4" aria-hidden />Trước
              </Button>
              <Button variant="outline" size="sm" disabled={!data.next_cursor || turning}
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
