'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, ExternalLink, PencilLine, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils/cn';
import { knowledgeKeys, useArchiveDocument, useDocument, useFields, useRestoreDocument, useRetryRevision } from '../hooks/use-knowledge';
import type { DocumentDetail, MetadataField } from '../types';
import { kbHref } from './kb-routes';
import { MarkdownPreview } from './markdown-preview';
import { fieldLabel } from './metadata-inputs';
import { ConfirmDialog } from './shared/confirm-dialog';
import { CopyButton } from './shared/copy-button';
import { errorMessage } from './shared/error-message';
import { fullDateTime, relativeTime } from './shared/format';
import { IndexStatus } from './shared/index-status';
import { QueryState } from './shared/query-state';

const CONFLICT = 'Tài liệu vừa thay đổi, đã tải lại.';

export interface RetrievedChunk {
  content: string;
  chunk?: number;
  revision?: number;
  score?: number;
  /** Highlights the query's terms in `content`. */
  query?: string;
}

export interface DocumentDetailSheetProps {
  kb: string;
  docId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `'error'` scrolls to and focuses the latest index error once loaded. */
  focus?: 'error';
  /** The chunk a retrieval test returned; shown on top of the sheet. */
  chunk?: RetrievedChunk;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.map(String).join(', ') : '—';
  return String(value);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-3 py-1.5 text-13">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function ChunkBlock({ chunk }: { chunk: RetrievedChunk }) {
  const place = [chunk.chunk !== undefined && `Chunk #${chunk.chunk}`, chunk.revision !== undefined && `r${chunk.revision}`].filter(Boolean).join(' · ');
  return (
    <section aria-labelledby="doc-chunk-heading" className="rounded-lg border bg-primary-subtle/60 p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <h3 id="doc-chunk-heading" className="text-13 font-semibold">Đoạn được truy xuất</h3>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {place}{chunk.score !== undefined && `${place ? ' · ' : ''}${chunk.score.toFixed(3)}`}
        </span>
        <CopyButton value={chunk.content} label="Copy đoạn" copiedLabel="Đã copy đoạn" iconOnly variant="ghost" className="-my-1 h-7 w-7 text-muted-foreground" />
      </div>
      <MarkdownPreview source={chunk.content} highlight={chunk.query} compact className="max-h-60 overflow-y-auto" />
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Đang tải tài liệu" className="space-y-3">
      <Skeleton className="h-4 w-2/3" />
      {Array.from({ length: 6 }, (_, row) => <Skeleton key={row} className="h-4 w-full" />)}
    </div>
  );
}

function DocumentDetailBody({ kb, detail, fields, fieldsFailed, focus }: {
  kb: string; detail: DocumentDetail; fields: MetadataField[] | undefined; fieldsFailed: boolean; focus?: 'error';
}) {
  const client = useQueryClient();
  const archive = useArchiveDocument();
  const restore = useRestoreDocument();
  const retry = useRetryRevision();
  const [confirmOff, setConfirmOff] = useState(false);
  const errorRef = useRef<HTMLElement>(null);
  const focused = useRef(false);
  const { latest } = detail;
  const failed = latest.index_status === 'error';
  const enabled = detail.status === 'active';

  // Only once per opened document, so polling refetches do not steal focus.
  useEffect(() => {
    if (focus !== 'error' || focused.current || !errorRef.current) return;
    focused.current = true;
    errorRef.current.scrollIntoView?.({ block: 'nearest' });
    errorRef.current.focus();
  }, [focus, failed]);

  const report = (error: unknown) => {
    if (error instanceof ApiError && error.httpStatus === 409) {
      toast.error(CONFLICT);
      void client.invalidateQueries({ queryKey: knowledgeKeys.document(kb, detail.id) });
    } else {
      toast.error(errorMessage(error));
    }
  };
  const target = { kb, doc: detail.id, expected_revision: detail.revision };
  const turnOff = async () => {
    try { await archive.mutateAsync(target); toast.success('Đã tắt truy xuất'); } catch (error) { report(error); }
  };
  const turnOn = async () => {
    try { await restore.mutateAsync(target); toast.success('Đã bật truy xuất'); } catch (error) { report(error); }
  };
  const retryIndex = async () => {
    try {
      await retry.mutateAsync({ kb, doc: detail.id, revision: latest.revision });
      toast.success(`Đang index lại r${latest.revision}`);
    } catch (error) { report(error); }
  };

  const sortedFields = [...(fields ?? [])].sort((a, b) => a.ordinal - b.ordinal);
  return (
    <div className="space-y-5">
      <dl className="divide-y">
        <Row label="ID">
          <span className="flex items-center gap-1">
            <code className="min-w-0 truncate font-mono text-xs">{detail.id}</code>
            <CopyButton value={detail.id} iconOnly variant="ghost" label="Copy ID" className="h-7 w-7" />
          </span>
        </Row>
        <Row label="Nguồn">
          {latest.source_url
            ? (
              <a href={latest.source_url} target="_blank" rel="noopener noreferrer"
                className="inline-flex max-w-full items-center gap-1 rounded-sm text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="truncate">{latest.source_url}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
            )
            : <span className="text-muted-foreground">—</span>}
        </Row>
        <Row label="Loại">Markdown</Row>
        <Row label="Cập nhật">
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{relativeTime(detail.updated_at)}</span>
            </TooltipTrigger>
            <TooltipContent>{fullDateTime(detail.updated_at)}</TooltipContent>
          </Tooltip>
        </Row>
        <Row label="Trạng thái index">
          <span className="flex flex-col gap-0.5">
            <IndexStatus status={latest.index_status} />
            <span className="text-xs text-muted-foreground">
              Bản mới nhất r{latest.revision} · Agent đang dùng {detail.active ? `r${detail.active.revision}` : 'chưa có'}
            </span>
          </span>
        </Row>
      </dl>

      {failed && (
        <section ref={errorRef} tabIndex={-1} aria-labelledby="doc-error-heading"
          className="space-y-2 rounded-lg border border-destructive/30 bg-destructive-subtle p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex items-center justify-between gap-2">
            <h3 id="doc-error-heading" className="flex items-center gap-1.5 text-13 font-semibold text-destructive">
              <CircleAlert className="h-4 w-4" aria-hidden />Lỗi gần nhất
            </h3>
            {latest.error && <CopyButton value={latest.error} iconOnly variant="ghost" label="Copy lỗi" className="h-7 w-7" />}
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{latest.error || 'Không có thông báo lỗi.'}</pre>
          <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => void retryIndex()}>
            <RotateCw className={cn('h-4 w-4', retry.isPending && 'animate-spin motion-reduce:animate-none')} aria-hidden />Thử index lại
          </Button>
        </section>
      )}

      <section aria-labelledby="doc-meta-heading">
        <h3 id="doc-meta-heading" className="mb-1 text-13 font-semibold">Metadata</h3>
        {fieldsFailed ? <p className="text-13 text-destructive">Không tải được danh sách trường metadata.</p>
          : fields === undefined ? <Skeleton className="h-4 w-1/2" /> : sortedFields.length === 0
          ? <p className="text-13 text-muted-foreground">Knowledge base chưa có trường metadata.</p>
          : (
            <dl className="divide-y">
              {sortedFields.map(field => <Row key={field.id} label={fieldLabel(field)}>{formatValue(latest.metadata[field.name])}</Row>)}
            </dl>
          )}
      </section>

      <section className="flex items-start justify-between gap-3 rounded-lg border p-3">
        <div>
          <Label htmlFor="doc-retrieval-switch" className="text-13 font-medium">Cho phép truy xuất</Label>
          <p className="text-xs text-muted-foreground">Tắt không xoá dữ liệu, bật lại dùng được ngay.</p>
        </div>
        <Switch id="doc-retrieval-switch" checked={enabled} disabled={archive.isPending || restore.isPending}
          onCheckedChange={on => { if (on) void turnOn(); else setConfirmOff(true); }} />
      </section>
      <ConfirmDialog open={confirmOff} onOpenChange={setConfirmOff} title={`Tắt truy xuất "${latest.title}"?`}
        description="Agent sẽ không truy xuất tài liệu này nữa. Dữ liệu không bị xoá." confirmLabel="Tắt truy xuất" destructive
        onConfirm={turnOff} />
    </div>
  );
}

/** Read-only document detail for the documents table and the retrieval inspector; editing happens in the editor. */
export function DocumentDetailSheet({ kb, docId, open, onOpenChange, focus, chunk }: DocumentDetailSheetProps) {
  const query = useDocument(kb, open ? docId : null, { pollWhilePending: true });
  const fields = useFields(kb);
  const title = query.data?.latest.title;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="gap-0 p-0 sm:max-w-[480px]"
        // The error block takes focus itself (see DocumentDetailBody); don't let Radix move it to the first button.
        onOpenAutoFocus={event => { if (focus === 'error' && query.data?.latest.index_status === 'error') event.preventDefault(); }}
      >
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="break-words">{title ?? 'Chi tiết tài liệu'}</SheetTitle>
          <SheetDescription className="text-13">Chỉ xem. Mở trình soạn để sửa nội dung hoặc metadata.</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {chunk && <ChunkBlock chunk={chunk} />}
          {/* Keyed by document so the one-shot error focus resets when the sheet shows another document. */}
          <QueryState query={query} loading={<DetailSkeleton />}>
            {detail => <DocumentDetailBody key={detail.id} kb={kb} detail={detail} fields={fields.data} fieldsFailed={!!fields.error} focus={focus} />}
          </QueryState>
        </div>
        {docId && (
          <SheetFooter className="border-t px-6 py-3">
            <Button asChild>
              <Link href={kbHref(kb, `documents/${encodeURIComponent(docId)}`)}><PencilLine className="h-4 w-4" aria-hidden />Mở trong trình soạn</Link>
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
