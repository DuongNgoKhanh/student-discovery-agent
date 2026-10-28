'use client';

import { Button } from '@/components/ui/button';
import { relativeTime } from '@/features/knowledge';
import type { AgentActive } from '../types';

export type DraftState = 'unsaved' | 'differs' | 'same';
const LABEL: Record<DraftState, string> = { unsaved: 'Chưa lưu', differs: 'Đã lưu · khác bản đang dùng', same: 'Trùng bản đang dùng' };

export function AgentStatusBar({ active, draftState, busy, onSave, onValidate, onPublish }: {
  active: AgentActive | null | undefined; draftState: DraftState; busy: boolean;
  onSave: () => void; onValidate: () => void; onPublish: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 py-3 backdrop-blur">
      <p className="text-13 text-muted-foreground">
        {active ? <>Đang dùng <strong className="text-foreground">v{active.version}</strong> · {relativeTime(active.updated_at)}</> : 'Chưa có bản phát hành'}
        <span className="mx-2">·</span>
        <span data-testid="draft-state">{LABEL[draftState]}</span>
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={busy || draftState !== 'unsaved'} onClick={onSave}>Lưu nháp</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={onValidate}>Kiểm tra</Button>
        <Button size="sm" disabled={busy || draftState !== 'differs'} onClick={onPublish}>Phát hành</Button>
      </div>
    </div>
  );
}
