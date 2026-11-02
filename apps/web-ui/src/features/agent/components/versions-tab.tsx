'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { ConfirmDialog, QueryState, errorMessage, fullDateTime } from '@/features/knowledge';
import { actionKey, agentKeys, useAgentRelease, useAgentReleases, useRestore } from '../hooks/use-agent';
import { ApiError } from '@/lib/api/errors';
import { conflictMessage } from '../model/conflict';
import type { AgentActive, AgentConfig, AgentIssue, AgentReleaseSummary } from '../types';
import { AuditList } from './audit-list';

export interface VersionsTabProps { active: AgentActive | null; onCopyToDraft: (content: AgentConfig) => void }

export function VersionsTab({ active, onCopyToDraft }: VersionsTabProps) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const releases = useAgentReleases(cursors.at(-1) ?? null);
  const client = useQueryClient();
  const restore = useRestore();
  const [viewing, setViewing] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  // The key is minted when the target is chosen, so retrying the same confirmation replays.
  // issues: why the runtime refused this release, shown in the dialog; retrying cannot help, so confirm is disabled.
  const [restoring, setRestoring] = useState<{ release: AgentReleaseSummary; key: string; issues?: AgentIssue[] } | null>(null);
  const viewed = useAgentRelease(viewing ?? copying);

  const doRestore = async ({ release, key }: { release: AgentReleaseSummary; key: string }) => {
    if (!active) return;
    try {
      await restore.mutateAsync({ id: release.id, expected_active_revision: active.revision, idempotency_key: key });
      toast.success(`Đã chuyển sang v${release.version}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PUBLISH_GATE_FAILED') {
        const issues = (error.details as { issues?: AgentIssue[] } | undefined)?.issues ?? [];
        setRestoring({ release, key, issues });
        throw error; // keeps the dialog open on the issue list
      }
      const conflict = conflictMessage(error);
      if (conflict) {
        void client.invalidateQueries({ queryKey: agentKeys.all });
        toast.error(conflict);
        return; // resolves, so the confirm closes
      }
      toast.error(errorMessage(error)); throw error;
    }
  };

  return (
    <div className="space-y-6">
      <QueryState query={releases}>{page => (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-13">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr><th className="p-2">Phiên bản</th><th className="p-2">Ghi chú</th><th className="p-2">Người phát hành</th><th className="p-2">Thời điểm</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {page.items.map(release => (
                <tr key={release.id} className="border-t">
                  <td className="p-2 font-medium">v{release.version} {release.is_active && <span className="ml-1 rounded bg-primary-subtle px-1.5 text-xs text-primary">Đang dùng</span>}</td>
                  <td className="p-2">{release.note ?? '—'}</td>
                  <td className="p-2">{release.created_by}</td>
                  <td className="p-2">{fullDateTime(release.created_at)}</td>
                  <td className="space-x-1 whitespace-nowrap p-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setViewing(release.id)}>Xem</Button>
                    <Button size="sm" variant="ghost" onClick={() => setCopying(release.id)}>Chép vào nháp</Button>
                    {active && !release.is_active && <Button size="sm" variant="outline" aria-label={`Khôi phục v${release.version}`} onClick={() => setRestoring({ release, key: actionKey('restore') })}>Khôi phục</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end gap-2 border-t p-2">
            <Button size="sm" variant="ghost" disabled={cursors.length < 2} onClick={() => setCursors(c => c.slice(0, -1))}>Trước</Button>
            <Button size="sm" variant="ghost" disabled={!page.next_cursor} onClick={() => setCursors(c => [...c, page.next_cursor])}>Sau</Button>
          </div>
        </div>
      )}</QueryState>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Lịch sử thao tác</h2>
        <AuditList />
      </section>

      <Sheet open={viewing !== null} onOpenChange={open => { if (!open) setViewing(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetTitle>{viewed.data ? `Nội dung v${viewed.data.version}` : 'Nội dung phiên bản'}</SheetTitle>
          <pre className="mt-4 whitespace-pre-wrap break-words rounded bg-muted p-3 font-mono text-xs">{viewed.data ? JSON.stringify(viewed.data.content, null, 2) : 'Đang tải…'}</pre>
        </SheetContent>
      </Sheet>

      {restoring && (
        <ConfirmDialog open onOpenChange={open => { if (!open) setRestoring(null); }} title={`Khôi phục v${restoring.release.version}?`}
          description={restoring.issues ? (
            <span className="block space-y-2">
              <span className="block text-destructive">v{restoring.release.version} không còn hợp lệ với hệ thống hiện tại nên chưa thể khôi phục:</span>
              <span className="block space-y-1" role="list">
                {restoring.issues.map((issue, index) => (
                  <span key={`${index}:${issue.path}`} role="listitem" className="block">
                    <code>{issue.path || '(toàn bộ)'}</code>: {issue.message}
                  </span>
                ))}
              </span>
              <span className="block">Chép phiên bản này vào nháp để sửa rồi phát hành lại.</span>
            </span>
          ) : `Chuyển sang v${restoring.release.version}. Hội thoại đang diễn ra không bị ảnh hưởng.`}
          confirmLabel="Khôi phục" confirmDisabled={Boolean(restoring.issues)}
          onConfirm={() => doRestore(restoring)} />
      )}
      {copying && (
        <ConfirmDialog open onOpenChange={open => { if (!open) setCopying(null); }} title="Chép phiên bản này vào nháp?"
          description="Nội dung nháp hiện tại trên form sẽ bị thay thế (chưa lưu cho tới khi bạn bấm Lưu nháp)." confirmLabel={viewed.data ? 'Chép vào nháp' : 'Đang tải…'} confirmDisabled={!viewed.data}
          onConfirm={() => { if (viewed.data) onCopyToDraft(viewed.data.content); }} />
      )}
    </div>
  );
}
