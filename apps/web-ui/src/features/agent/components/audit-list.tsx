'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { QueryState, fullDateTime } from '@/features/knowledge';
import { useAgentAudit, useAgentReleases } from '../hooks/use-agent';
import type { AuditEvent } from '../types';

const ACTION: Record<string, string> = {
  'agent.draft.save': 'Lưu nháp', 'agent.release.publish': 'Phát hành', 'agent.release.restore': 'Khôi phục',
};

const shortRef = (ref: string) => (ref.length > 12 ? `${ref.slice(0, 12)}…` : ref);

export function AuditList() {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const audit = useAgentAudit(cursors.at(-1) ?? null);
  // Release ids -> version labels, from the (cached) newest releases page.
  const versionOf = new Map((useAgentReleases(null).data?.items ?? []).map(r => [r.id, `v${r.version}`]));

  const label = (ref: string | null, event: AuditEvent, side: 'before' | 'after') => {
    if (!ref) return '—';
    if (ref.startsWith('draft@')) return ref;
    const known = versionOf.get(ref);
    if (known) return known;
    if (side === 'after' && typeof event.details?.version === 'number') return `v${event.details.version}`;
    return shortRef(ref);
  };

  return (
    <QueryState query={audit}>{page => (
      <div className="space-y-2">
        <ul className="divide-y rounded-lg border text-13">
          {page.items.length === 0 && <li className="p-3 text-muted-foreground">Chưa có thao tác nào.</li>}
          {page.items.map(event => (
            <li key={event.id} className="flex flex-wrap justify-between gap-2 p-3">
              <span>
                <strong>{ACTION[event.action] ?? event.action}</strong>
                {(event.before_ref || event.after_ref) && ` · ${label(event.before_ref, event, 'before')} → ${label(event.after_ref, event, 'after')}`}
                <span className={event.outcome === 'success' ? 'ml-2 rounded bg-primary-subtle px-1.5 text-xs text-primary' : 'ml-2 rounded bg-destructive/10 px-1.5 text-xs text-destructive'}>
                  {event.outcome === 'success' ? 'Thành công' : 'Bị từ chối'}
                </span>
              </span>
              <span className="text-muted-foreground">{event.actor} · {fullDateTime(event.at)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={cursors.length < 2} onClick={() => setCursors(c => c.slice(0, -1))}>Trước</Button>
          <Button size="sm" variant="ghost" disabled={!page.next_cursor} onClick={() => setCursors(c => [...c, page.next_cursor])}>Sau</Button>
        </div>
      </div>
    )}</QueryState>
  );
}
