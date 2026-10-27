'use client';

import { useState } from 'react';
import { Archive, ArchiveRestore, MoreHorizontal, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { useArchiveDocument, useRestoreDocument, useRetryRevision } from '../hooks/use-knowledge';
import type { DocumentDetail } from '../types';
import { ErrorText } from './error-text';
import { ConfirmDialog } from './shared/confirm-dialog';
import { documentStatus } from './shared/document-status';
import { StatusDot } from './shared/status-dot';

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
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Thao tác khác" title="Thao tác khác">
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
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
            ? <DropdownMenuItem destructive onSelect={() => setConfirmArchive(true)}><Archive aria-hidden />Tắt tài liệu</DropdownMenuItem>
            : (
              <DropdownMenuItem
                disabled={restore.isPending}
                onSelect={() => restore.mutate(target, { onSuccess: () => toast.success('Đã bật tài liệu') })}
              >
                <ArchiveRestore aria-hidden />Bật tài liệu
              </DropdownMenuItem>
            )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmArchive} onOpenChange={setConfirmArchive}
        title="Tắt tài liệu này?" description="Agent sẽ không tìm thấy tài liệu này nữa. Bạn có thể bật lại bất cứ lúc nào."
        confirmLabel="Tắt tài liệu" destructive
        onConfirm={async () => { await archive.mutateAsync(target); toast.success('Đã tắt tài liệu'); }}
      />
      <ErrorText error={retry.error ?? archive.error ?? restore.error} />
    </>
  );
}

/** Right column: index status, the revision the agent reads, and the in-place metadata list (`children`). */
export function DocumentEditorInfo({ kb, detail, children }: { kb: string; detail: DocumentDetail | undefined; children: React.ReactNode }) {
  const status = detail ? documentStatus(detail) : null;
  return (
    <div className="space-y-6">
      <section aria-labelledby="doc-info-heading" className="space-y-1.5">
        <div className="flex h-8 items-center justify-between">
          <h2 id="doc-info-heading" className="text-13 font-semibold">Thông tin</h2>
          {detail && <DocumentActions kb={kb} detail={detail} />}
        </div>
        {detail && status
          ? (
            <>
              <p role="status" className="flex items-center gap-1.5 text-13">
                <StatusDot tone={status.tone}>{status.label}</StatusDot>
                <span className="text-muted-foreground">· r{detail.latest.revision}</span>
              </p>
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
