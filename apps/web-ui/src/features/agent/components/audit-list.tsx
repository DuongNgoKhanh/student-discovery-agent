'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { QueryState, fullDateTime } from '@/features/knowledge';
import { useAgentAudit } from '../hooks/use-agent';

const ACTION: Record<string, string> = {
  'agent.draft.save': 'Lưu nháp', 'agent.release.publish': 'Phát hành', 'agent.release.restore': 'Khôi phục',
};

export function AuditList() {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const audit = useAgentAudit(cursors.at(-1) ?? null);
  return (
    <QueryState query={audit}>{page => (
      <div className="space-y-2">
        <ul className="divide-y rounded-lg border text-13">
          {page.items.length === 0 && <li className="p-3 text-muted-foreground">Chưa có thao tác nào.</li>}
          {page.items.map(event => (
            <li key={event.id} className="flex flex-wrap justify-between gap-2 p-3">
              <span><strong>{ACTION[event.action] ?? event.action}</strong>{typeof event.details?.version === 'number' && ` → v${event.details.version}`}</span>
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
