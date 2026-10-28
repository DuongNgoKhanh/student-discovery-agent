'use client';

import type { AgentActive, AgentConfig } from '../types';

export interface VersionsTabProps { active: AgentActive | null; onCopyToDraft: (content: AgentConfig) => void }

// Stub; Task 11 replaces this.
export function VersionsTab(props: VersionsTabProps) { void props; return null; }
