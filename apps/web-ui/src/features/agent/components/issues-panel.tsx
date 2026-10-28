'use client';

import { CheckCircle2, AlertCircle } from 'lucide-react';
import { focusIssue } from '../model/config';
import { SECTIONS, sectionOf, type SectionId } from '../model/sections';
import type { AgentIssue } from '../types';

export interface ValidationState { issues: AgentIssue[]; valid: boolean; checkedAt: string; stale: boolean }

export function IssuesPanel({ state, onOpenSection }: { state: ValidationState; onOpenSection: (id: SectionId) => void }) {
  const label = (path: string) => SECTIONS.find(s => s.id === sectionOf(path))?.label ?? 'JSON';
  return (
    <section aria-label="Kết quả kiểm tra" className="rounded-lg border p-4 text-13">
      <p className="flex items-center gap-2 font-medium">
        {state.valid ? <CheckCircle2 className="h-4 w-4 text-status-success" aria-hidden /> : <AlertCircle className="h-4 w-4 text-destructive" aria-hidden />}
        {state.valid ? 'Cấu hình hợp lệ' : `${state.issues.length} lỗi cần sửa`}
        <span className="font-normal text-muted-foreground">· kiểm lúc {new Date(state.checkedAt).toLocaleTimeString('vi-VN')}</span>
        {state.stale && <span className="rounded bg-warning-subtle px-1.5 text-xs text-warning-foreground">Hết hiệu lực — đã sửa sau khi kiểm</span>}
      </p>
      {state.issues.length > 0 && (
        <ul className="mt-3 space-y-1">
          {state.issues.map(issue => (
            <li key={`${issue.path}:${issue.code}`}>
              <button type="button" className="text-left hover:underline" onClick={() => { onOpenSection(sectionOf(issue.path)); setTimeout(() => focusIssue(issue.path), 0); }}>
                <span className="text-muted-foreground">{label(issue.path)} · <code>{issue.path || '(toàn bộ)'}</code>:</span> {issue.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
