'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/features/knowledge';
import type { Path } from '../model/config';
import { sectionsForMode, type AgentMode, type SectionId } from '../model/sections';
import { agentApi } from '../api/agent';
import type { AgentConfig, ChatflowWorkflow, NodeTypeCatalog } from '../types';
import { IssuesPanel, type ValidationState } from './issues-panel';
import { JsonSection } from './json-section';
import { LimitsSection } from './limits-section';
import { ModelSection } from './model-section';
import { PersonaSection } from './persona-section';
import { SectionNav } from './section-nav';
import { TemplatesSection } from './templates-section';
import { ToolsSection } from './tools-section';
import { WorkflowJsonTab } from './workflow-json-tab';
import { NodeForm } from './node-form';
import { WorkflowCanvas } from './workflow-canvas';

type ChatflowTab = 'canvas' | 'json';

export function ConfigTab({ config, onChange, onReplace, section, onSection, onJsonValidity, validation, onBindKb, mode }: {
  config: AgentConfig; onChange: (path: Path, value: unknown) => void; onReplace: (next: AgentConfig) => void;
  section: SectionId; onSection: (id: SectionId) => void; onJsonValidity: (error: string | null) => void;
  validation: ValidationState | null; onBindKb: (kb: string) => void; mode?: AgentMode;
}) {
  const [chatflowTab, setChatflowTab] = useState<ChatflowTab>('canvas');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<NodeTypeCatalog | undefined>();
  const [catalogError, setCatalogError] = useState<unknown>(null);
  const handleJsonValidity = (error: string | null) => { setJsonError(error); onJsonValidity(error); };
  const visibleSections = sectionsForMode(mode ?? 'agent');
  const issues = validation?.issues ?? [];
  const workflow = config.workflow as ChatflowWorkflow | undefined;
  const workflowIssues = validation?.stale ? [] : issues;
  useEffect(() => {
    if (mode !== 'chatflow' || typeof agentApi.getNodeTypes !== 'function') return;
    let active = true;
    setCatalogError(null);
    void agentApi.getNodeTypes().then(next => {
      if (active) setCatalog(next);
    }).catch(error => {
      if (active) setCatalogError(error);
    });
    return () => { active = false; };
  }, [mode]);
  useEffect(() => {
    if (!workflow?.nodes.some(node => node.id === selectedNodeId)) setSelectedNodeId(null);
  }, [selectedNodeId, workflow]);
  const props = { config, onChange, issues };
  return (
    <div className="space-y-4">
      {validation && (
        <IssuesPanel
          state={validation}
          onOpenSection={onSection}
          workflow={mode === 'chatflow' ? validation.workflow ?? config.workflow as ChatflowWorkflow | undefined : undefined}
          onOpenWorkflowIssue={() => { if (!jsonError) setChatflowTab('json'); }}
        />
      )}
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
                <div className="space-y-4">
                  {catalogError ? (
                    <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      Không tải được catalog node: {errorMessage(catalogError)}
                    </p>
                  ) : null}
                  {workflow ? (
                    <>
                      <WorkflowCanvas
                        workflow={workflow}
                        catalog={catalog}
                        issues={workflowIssues}
                        selectedNodeId={selectedNodeId}
                        onSelectNode={setSelectedNodeId}
                        onChange={next => onChange(['workflow'], next)}
                      />
                      {selectedNodeId ? (
                        <NodeForm
                          workflow={workflow}
                          nodeId={selectedNodeId}
                          catalog={catalog}
                          onChange={next => onChange(['workflow'], next)}
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground">Chọn một node trên sơ đồ để chỉnh sửa.</p>
                      )}
                    </>
                  ) : (
                    <p className="rounded-lg border border-dashed p-6 text-13 text-muted-foreground">
                      Bản nháp Chatflow chưa có workflow.
                    </p>
                  )}
                </div>
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
