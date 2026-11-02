'use client';

import { useState } from 'react';
import { Archive, ArchiveRestore, MoreHorizontal, RotateCw } from 'lucide-react';
import { IconButton } from '@/components/shared/icon-button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { useArchiveDocument, useRestoreDocument, useRetryRevision } from '../hooks/use-knowledge';
import type { DocumentDetail } from '../types';
import { ErrorText } from './error-text';
import { ConfirmDialog } from './shared/confirm-dialog';
import { IndexStatus } from './shared/index-status';

function DocumentActions({ kb, detail }: { kb: string; detail: DocumentDetail }) {
  const archive = useArchiveDocument();
  const restore = useRestoreDocument();
  const retry = useRetryRevision();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const target = { kb, doc: detail.id, expected_revision: detail.revision };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton className="h-8 w-8" label="Thao tác khác">
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {detail.latest.index_status === 'error' && (
            <DropdownMenuItem
              disabled={retry.isPending}
              onSelect={() => retry.mutate({ kb, doc: detail.id, revision: detail.latest.revision }, {
                onSuccess: () => toast.success(`Đang index lại r${detail.latest.revision}`),
              })}
            >
              <RotateCw aria-hidden />Thử index lại
            </DropdownMenuItem>
          )}
          {detail.status === 'active'
            ? <DropdownMenuItem destructive onSelect={() => setConfirmArchive(true)}><Archive aria-hidden />Tắt truy xuất</DropdownMenuItem>
            : (
              <DropdownMenuItem
                disabled={restore.isPending}
                onSelect={() => restore.mutate(target, { onSuccess: () => toast.success('Đã bật truy xuất') })}
              >
                <ArchiveRestore aria-hidden />Bật truy xuất
              </DropdownMenuItem>
            )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmArchive} onOpenChange={setConfirmArchive}
        title="Tắt truy xuất tài liệu này?" description="Agent sẽ không truy xuất tài liệu này nữa. Dữ liệu không bị xoá."
        confirmLabel="Tắt truy xuất" destructive
        onConfirm={async () => { await archive.mutateAsync(target); toast.success('Đã tắt truy xuất'); }}
      />
      <ErrorText error={retry.error ?? archive.error ?? restore.error} />
    </>
  );
}

/** Right column: index status, the revision the agent reads, and the in-place metadata list (`children`). */
export function DocumentEditorInfo({ kb, detail, children }: { kb: string; detail: DocumentDetail | undefined; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="doc-info-heading" className="space-y-1.5">
        <div className="flex h-8 items-center justify-between">
          <h2 id="doc-info-heading" className="text-13 font-semibold">Thông tin</h2>
          {detail && <DocumentActions kb={kb} detail={detail} />}
        </div>
        {detail
          ? (
            <>
              <p role="status" className="flex items-center gap-1.5 text-13">
                <IndexStatus status={detail.latest.index_status} />
                <span className="text-muted-foreground">· r{detail.latest.revision}</span>
              </p>
              {detail.status === 'archived' && <p className="text-13 text-muted-foreground">Đã tắt truy xuất: agent không đọc tài liệu này.</p>}
              <p className="text-13 text-muted-foreground">
                {detail.active ? `Agent dùng r${detail.active.revision}` : 'Agent chưa dùng bản nào'}
              </p>
              {detail.latest.error && <p className="break-words text-13 text-destructive">{detail.latest.error}</p>}
            </>
          )
          : <p className="text-13 text-muted-foreground">Tài liệu mới, chưa lưu.</p>}
      </section>
      <section aria-labelledby="doc-metadata-heading" className="space-y-1.5">
        <h2 id="doc-metadata-heading" className="text-13 font-semibold">Metadata</h2>
        {children}
      </section>
    </div>
  );
}
