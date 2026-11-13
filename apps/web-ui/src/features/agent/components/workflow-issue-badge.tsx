import { workflowIssueLabel, type WorkflowIssueTarget } from '../model/workflow/issue-path';

export function WorkflowIssueBadge({ target }: { target: WorkflowIssueTarget }) {
  return <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">{workflowIssueLabel(target)}</span>;
}
