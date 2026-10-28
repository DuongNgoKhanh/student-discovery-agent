'use client';

import type { AgentActive, AgentDraft, AgentIssue } from '../types';

export interface PublishDialogProps {
  open: boolean; onOpenChange: (open: boolean) => void; draft: AgentDraft; active: AgentActive; onIssues: (issues: AgentIssue[]) => void;
}

// Stub; Task 11 replaces this.
export function PublishDialog(props: PublishDialogProps) { void props; return null; }
