'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/features/knowledge';
import type { Path } from '../model/config';
import { sectionsForMode, type AgentMode, type SectionId } from '../model/sections';
import { useAgentNodeTypes } from '../hooks/use-agent';
import { isRenderableWorkflow } from '../model/workflow/shape';
import type { AgentConfig, ChatflowWorkflow } from '../types';
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
  const nodeTypes = useAgentNodeTypes(mode === 'chatflow');
  const catalog = nodeTypes.data;
  const handleJsonValidity = (error: string | null) => { setJsonError(error); onJsonValidity(error); };
  const visibleSections = sectionsForMode(mode ?? 'agent');
  const issues = validation?.issues ?? [];
  const workflow = isRenderableWorkflow(config.workflow) ? config.workflow : undefined;
  const workflowMalformed = config.workflow != null && !workflow;
  const workflowIssues = validation?.stale ? [] : issues;
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
        {/* The canvas needs the room; form sections keep a readable line length. */}
        <div className={section === 'chatflow' ? 'min-w-0' : 'max-w-3xl'}>
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
                  {/* Without the catalog nodes have no handles, so edges cannot be drawn: keep the canvas read-only until it loads. */}
                  {nodeTypes.isError ? (
                    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                      <span>Không tải được catalog node: {errorMessage(nodeTypes.error)}. Sơ đồ chỉ xem cho tới khi tải được.</span>
                      <button type="button" className="underline" onClick={() => void nodeTypes.refetch()}>Thử lại</button>
                    </div>
                  ) : !catalog ? (
                    <p role="status" className="text-sm text-muted-foreground">Đang tải catalog node…</p>
                  ) : null}
                  {workflow ? (
                    <WorkflowCanvas
                      className="h-[calc(100vh-16rem)] min-h-[560px] w-full"
                      workflow={workflow}
                      catalog={catalog}
                      readOnly={!catalog}
                      issues={workflowIssues}
                      selectedNodeId={selectedNodeId}
                      onSelectNode={id => { if (!jsonError) setSelectedNodeId(id); }}
                      onChange={next => onChange(['workflow'], next)}
                      overlay={selectedNodeId ? (
                        <aside
                          aria-label="Cấu hình node"
                          className="absolute inset-y-3 right-3 z-10 flex w-[min(420px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border bg-card shadow-xl animate-in fade-in slide-in-from-right-4 duration-200 motion-reduce:animate-none"
                        >
                          <NodeForm
                            // Per-node field state (typed text, errors) must not carry over to the next node.
                            key={selectedNodeId}
                            onValidity={handleJsonValidity}
                            workflow={workflow}
                            nodeId={selectedNodeId}
                            catalog={catalog}
                            readOnly={!catalog}
                            onChange={next => onChange(['workflow'], next)}
                            onClose={() => { if (!jsonError) setSelectedNodeId(null); }}
                          />
                        </aside>
                      ) : null}
                    />
                  ) : workflowMalformed ? (
                    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-13 text-destructive">
                      Workflow chưa đúng cấu trúc (cần mảng nodes, mỗi node có id và type) — sửa ở tab JSON.
                    </p>
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
