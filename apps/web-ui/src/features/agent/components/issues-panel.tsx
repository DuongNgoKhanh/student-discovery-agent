'use client';

import { CheckCircle2, AlertCircle } from 'lucide-react';
import { focusIssue } from '../model/config';
import { sectionLabel, sectionOf, type SectionId } from '../model/sections';
import {
  findWorkflowIssueRange,
  parseWorkflowIssuePath,
  workflowIssueKey,
  type WorkflowIssueTarget,
} from '../model/workflow/issue-path';
import type { AgentIssue, ChatflowWorkflow } from '../types';
import { WorkflowIssueBadge } from './workflow-issue-badge';

export interface ValidationState {
  issues: AgentIssue[]; valid: boolean; checkedAt: string; stale: boolean;
  /** Draft revision the report was computed for; a different current revision marks it stale. */
  draftRevision?: number;
  /** Workflow the report was computed for; issue paths index into it, not into the edited copy. */
  workflow?: ChatflowWorkflow;
}

type IndexedIssue = { issue: AgentIssue; index: number };
type WorkflowGroup = { key: string; target: WorkflowIssueTarget; items: IndexedIssue[] };

function groupWorkflowIssues(issues: IndexedIssue[], workflow: ChatflowWorkflow): WorkflowGroup[] {
  const groups = new Map<string, WorkflowGroup>();
  for (const item of issues) {
    const target = parseWorkflowIssuePath(item.issue.path, workflow);
    const key = workflowIssueKey(target);
    const existing = groups.get(key);
    if (existing) existing.items.push(item);
    else groups.set(key, { key, target, items: [item] });
  }
  return Array.from(groups.values());
}

export function IssuesPanel({ state, onOpenSection, workflow, onOpenWorkflowIssue }: {
  state: ValidationState;
  onOpenSection: (id: SectionId) => void;
  workflow?: ChatflowWorkflow;
  onOpenWorkflowIssue?: (target: WorkflowIssueTarget, issue: AgentIssue) => void;
}) {
  const label = (path: string) => sectionLabel(sectionOf(path));
  const locate = (issue: AgentIssue) => {
    if (!workflow || sectionOf(issue.path) !== 'chatflow') {
      onOpenSection(sectionOf(issue.path));
      setTimeout(() => focusIssue(issue.path), 0);
      return;
    }
    const target = parseWorkflowIssuePath(issue.path, workflow);
    onOpenSection('chatflow');
    onOpenWorkflowIssue?.(target, issue);
    setTimeout(() => {
      const editor = document.getElementById('field-workflow') as HTMLTextAreaElement | null;
      if (!editor) return;
      const range = findWorkflowIssueRange(editor.value, target);
      editor.focus();
      if (range) {
        editor.setSelectionRange(range.start, range.end);
        const linesBefore = editor.value.slice(0, range.start).split('\n').length - 1;
        const totalLines = editor.value.split('\n').length;
        editor.scrollTop = editor.scrollHeight * (linesBefore / Math.max(totalLines, 1));
      }
    }, 0);
  };

  const indexed: IndexedIssue[] = state.issues.map((issue, index) => ({ issue, index }));
  const generalIssues = workflow ? indexed.filter(item => sectionOf(item.issue.path) !== 'chatflow') : indexed;
  const workflowGroups = workflow ? groupWorkflowIssues(indexed.filter(item => sectionOf(item.issue.path) === 'chatflow'), workflow) : [];

  return (
    <section aria-label="Kết quả kiểm tra" className="rounded-lg border p-4 text-13">
      <p className="flex items-center gap-2 font-medium">
        {state.valid ? <CheckCircle2 className="h-4 w-4 text-status-success" aria-hidden /> : <AlertCircle className="h-4 w-4 text-destructive" aria-hidden />}
        {state.valid ? 'Cấu hình hợp lệ' : `${state.issues.length} lỗi cần sửa`}
        <span className="font-normal text-muted-foreground">· kiểm lúc {new Date(state.checkedAt).toLocaleTimeString('vi-VN')}</span>
        {state.stale && <span className="rounded bg-warning-subtle px-1.5 text-xs text-warning-foreground">Hết hiệu lực — đã sửa sau khi kiểm</span>}
      </p>
      {state.issues.length > 0 && (
        <ul className="mt-3 space-y-2">
          {generalIssues.map(({ issue, index }) => (
            <li key={`${index}:${issue.path}:${issue.code}`}>
              <button type="button" className="text-left hover:underline" onClick={() => locate(issue)}>
                <span className="text-muted-foreground">{label(issue.path)} · <code>{issue.path || '(toàn bộ)'}</code>:</span> {issue.message}
              </button>
            </li>
          ))}
          {workflowGroups.map(group => (
            <li key={group.key} className="space-y-1">
              <div className="flex items-center gap-2">
                <WorkflowIssueBadge target={group.target} />
              </div>
              <ul className="space-y-1 border-l border-border pl-3">
                {group.items.map(({ issue, index }) => (
                  <li key={`${index}:${issue.path}:${issue.code}`}>
                    <button type="button" className="text-left hover:underline" onClick={() => locate(issue)}>
                      <span className="text-muted-foreground"><code>{issue.path || '(toàn bộ)'}</code>:</span> {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
