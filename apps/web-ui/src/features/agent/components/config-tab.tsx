'use client';

import type { Path } from '../model/config';
import type { SectionId } from '../model/sections';
import type { AgentConfig } from '../types';
import { IssuesPanel, type ValidationState } from './issues-panel';
import { JsonSection } from './json-section';
import { LimitsSection } from './limits-section';
import { ModelSection } from './model-section';
import { PersonaSection } from './persona-section';
import { SectionNav } from './section-nav';
import { TemplatesSection } from './templates-section';
import { ToolsSection } from './tools-section';

export function ConfigTab({ config, onChange, onReplace, section, onSection, onJsonValidity, validation, onBindKb }: {
  config: AgentConfig; onChange: (path: Path, value: unknown) => void; onReplace: (next: AgentConfig) => void;
  section: SectionId; onSection: (id: SectionId) => void; onJsonValidity: (error: string | null) => void;
  validation: ValidationState | null; onBindKb: (kb: string) => void;
}) {
  const issues = validation?.issues ?? [];
  const props = { config, onChange, issues };
  return (
    <div className="space-y-4">
      {validation && <IssuesPanel state={validation} onOpenSection={onSection} />}
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <SectionNav active={section} onSelect={onSection} issues={issues} />
        <div className="max-w-3xl">
          {section === 'persona' && <PersonaSection {...props} />}
          {section === 'model' && <ModelSection {...props} />}
          {section === 'tools' && <ToolsSection {...props} onBindKb={onBindKb} />}
          {section === 'limits' && <LimitsSection {...props} />}
          {section === 'templates' && <TemplatesSection {...props} />}
          {section === 'json' && <JsonSection config={config} onReplace={onReplace} onValidity={onJsonValidity} />}
        </div>
      </div>
    </div>
  );
}
