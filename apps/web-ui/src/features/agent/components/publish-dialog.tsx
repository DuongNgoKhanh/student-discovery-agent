'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/features/knowledge';
import { ApiError } from '@/lib/api/errors';
import { actionKey, useAgentRelease, usePublish } from '../hooks/use-agent';
import { changedSections, SECTIONS } from '../model/sections';
import type { AgentActive, AgentDraft, AgentIssue } from '../types';

export interface PublishDialogProps {
  open: boolean; onOpenChange: (open: boolean) => void; draft: AgentDraft; active: AgentActive; onIssues: (issues: AgentIssue[]) => void;
}

export function PublishDialog({ open, onOpenChange, draft, active, onIssues }: PublishDialogProps) {
  const current = useAgentRelease(active.release_id);
  const publish = usePublish();
  const [note, setNote] = useState('');
  // One key per open dialog: a retry after a network error replays instead of publishing twice.
  const [key] = useState(() => actionKey('publish'));
  const changed = useMemo(() => (current.data ? changedSections(current.data.content, draft.content) : []), [current.data, draft.content]);
  const next = active.version + 1;

  const submit = async () => {
    try {
      const release = await publish.mutateAsync({ expected_draft_revision: draft.revision, expected_active_revision: active.revision,
        note: note.trim() || undefined, idempotency_key: key });
      toast.success(`Đã phát hành v${release.version} — áp dụng cho hội thoại mới`);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PUBLISH_GATE_FAILED') {
        onIssues(((error.details as { issues?: AgentIssue[] } | undefined)?.issues) ?? []);
        onOpenChange(false);
        return;
      }
      toast.error(errorMessage(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={value => { if (!publish.isPending) onOpenChange(value); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Phát hành v{next}</DialogTitle>
          <DialogDescription>Bản mới áp dụng cho hội thoại mở sau khi phát hành; hội thoại đang diễn ra giữ nguyên.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-13">
          <div>
            <p className="font-medium">Thay đổi so với v{active.version}:</p>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {!current.data ? <li>Đang tải…</li>
                : changed.length ? changed.map(id => <li key={id}>{SECTIONS.find(s => s.id === id)?.label}</li>)
                : <li>Không có thay đổi nội dung</li>}
            </ul>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="publish-note">Ghi chú phát hành</Label>
            <Textarea id="publish-note" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="Ví dụ: đổi lời chào mùa tuyển sinh" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={publish.isPending}>Huỷ</Button>
          <Button onClick={() => void submit()} disabled={publish.isPending}>Phát hành v{next}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
