'use client';

import { cn } from '@/lib/utils/cn';
import { SECTIONS, sectionOf, type SectionId } from '../model/sections';
import type { AgentIssue } from '../types';

export function SectionNav({ active, onSelect, issues }: { active: SectionId; onSelect: (id: SectionId) => void; issues: AgentIssue[] }) {
  return (
    <nav aria-label="Nhóm cấu hình" className="flex flex-row gap-1 overflow-x-auto md:flex-col">
      {SECTIONS.map(section => {
        const count = issues.filter(issue => sectionOf(issue.path) === section.id).length;
        return (
          <button key={section.id} type="button" aria-current={active === section.id ? 'page' : undefined} onClick={() => onSelect(section.id)}
            className={cn('flex h-8 items-center justify-between gap-2 whitespace-nowrap rounded-md px-2 text-left text-13',
              active === section.id ? 'bg-primary-subtle font-medium text-primary' : 'hover:bg-primary-subtle')}>
            {section.label}
            {count > 0 && <span className="rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground">{count}</span>}
          </button>
        );
      })}
    </nav>
  );
}
