'use client';

import { useState } from 'react';
import type { Path } from '../model/config';
import { sectionsForMode, type AgentMode, type SectionId } from '../model/sections';
import type { AgentConfig } from '../types';
import { IssuesPanel, type ValidationState } from './issues-panel';
import { JsonSection } from './json-section';
import { LimitsSection } from './limits-section';
import { ModelSection } from './model-section';
import { PersonaSection } from './persona-section';
import { SectionNav } from './section-nav';
import { TemplatesSection } from './templates-section';
import { ToolsSection } from './tools-section';
import { WorkflowJsonTab } from './workflow-json-tab';

type ChatflowTab = 'canvas' | 'json';

export function ConfigTab({ config, onChange, onReplace, section, onSection, onJsonValidity, validation, onBindKb, mode }: {
  config: AgentConfig; onChange: (path: Path, value: unknown) => void; onReplace: (next: AgentConfig) => void;
  section: SectionId; onSection: (id: SectionId) => void; onJsonValidity: (error: string | null) => void;
  validation: ValidationState | null; onBindKb: (kb: string) => void; mode?: AgentMode;
}) {
  const [chatflowTab, setChatflowTab] = useState<ChatflowTab>('canvas');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const handleJsonValidity = (error: string | null) => { setJsonError(error); onJsonValidity(error); };
  const visibleSections = sectionsForMode(mode ?? 'agent');
  const issues = validation?.issues ?? [];
  const props = { config, onChange, issues };
  return (
    <div className="space-y-4">
      {validation && <IssuesPanel state={validation} onOpenSection={onSection} />}
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <SectionNav active={section} onSelect={onSection} issues={issues} sections={visibleSections} />
        <div className="max-w-3xl">
          {section === 'chatflow' && (
            <div className="space-y-4">
              <div role="tablist" aria-label="Chế độ xem Chatflow" className="flex gap-4 border-b text-sm">
                {(['canvas', 'json'] as const).map(id => (
                  <button key={id} role="tab" aria-selected={chatflowTab === id} type="button"
                    onClick={() => { if (!jsonError) setChatflowTab(id); }}
                    className={chatflowTab === id ? 'border-b-2 border-primary pb-2 font-medium' : 'pb-2 text-muted-foreground'}>
                    {id === 'canvas' ? 'Sơ đồ' : 'JSON'}
                  </button>
                ))}
              </div>
              {chatflowTab === 'canvas' ? (
                <div className="rounded-lg border border-dashed p-6 text-13 text-muted-foreground">Chatflow editor sẽ xuất hiện ở đây.</div>
              ) : (
                <WorkflowJsonTab
                  workflow={config.workflow as Record<string, unknown> | undefined}
                  onReplace={next => onChange(['workflow'], next)}
                  onValidity={handleJsonValidity}
                />
              )}
            </div>
          )}
          {section === 'persona' && <PersonaSection {...props} />}
          {section === 'model' && <ModelSection {...props} />}
          {section === 'tools' && <ToolsSection {...props} onBindKb={onBindKb} />}
          {section === 'limits' && <LimitsSection {...props} />}
          {section === 'templates' && <TemplatesSection {...props} />}
          {section === 'json' && <JsonSection config={config} onReplace={onReplace} onValidity={handleJsonValidity} />}
        </div>
      </div>
    </div>
  );
}
