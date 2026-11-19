'use client';

import { Maximize2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/knowledge';
import type { Path } from '../model/config';
import { sectionsForMode, type AgentMode, type SectionId } from '../model/sections';
import { useAgentNodeTypes } from '../hooks/use-agent';
import { isRenderableWorkflow } from '../model/workflow/shape';
import type { AgentConfig, ChatflowWorkflow } from '../types';
import { ChatflowEditor } from './chatflow-editor';
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
import { DebugRunTab } from './debug-run-tab';

type ChatflowTab = 'canvas' | 'json' | 'debug';

const CHATFLOW_TABS: ReadonlyArray<{ id: ChatflowTab; label: string }> = [
  { id: 'canvas', label: 'Sơ đồ' },
  { id: 'json', label: 'JSON' },
  { id: 'debug', label: 'Chạy thử' },
];

export function ConfigTab({
  config, onChange, onReplace, section, onSection, onJsonValidity, validation, onBindKb, mode,
  chatflowOpen = false, onChatflowOpen = () => {}, chatflowActions,
  onBeforeDebugRun,
}: {
  config: AgentConfig; onChange: (path: Path, value: unknown) => void; onReplace: (next: AgentConfig) => void;
  section: SectionId; onSection: (id: SectionId) => void; onJsonValidity: (error: string | null) => void;
  validation: ValidationState | null; onBindKb: (kb: string) => void; mode?: AgentMode;
  /** Whether the full-window chatflow editor is open; the page owns it so the browser Back button can close it. */
  chatflowOpen?: boolean; onChatflowOpen?: (open: boolean) => void;
  /** Draft actions (save, validate, publish) shown in the editor's header. */
  chatflowActions?: ReactNode;
  onBeforeDebugRun?: () => Promise<boolean>;
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
      {/* The open editor lists the report itself, above its canvas. */}
      {validation && !(chatflowOpen && mode === 'chatflow') && (
        <IssuesPanel
          state={validation}
          onOpenSection={onSection}
          workflow={mode === 'chatflow' ? validation.workflow ?? config.workflow as ChatflowWorkflow | undefined : undefined}
          onOpenWorkflowIssue={() => { if (!jsonError) { setChatflowTab('json'); onChatflowOpen(true); } }}
        />
      )}
      {mode === 'chatflow' && chatflowOpen && (
        <ChatflowEditor
          onClose={() => onChatflowOpen(false)}
          closeDisabled={Boolean(jsonError)}
          actions={chatflowActions}
          tabs={
            <div role="tablist" aria-label="Chế độ xem Chatflow" className="flex gap-1 rounded-lg bg-muted p-0.5 text-13">
              {CHATFLOW_TABS.map(tab => (
                <button key={tab.id} role="tab" aria-selected={chatflowTab === tab.id} type="button"
                  onClick={() => { if (!jsonError) setChatflowTab(tab.id); }}
                  className={chatflowTab === tab.id ? 'rounded-md bg-background px-3 py-1 font-medium shadow-sm' : 'rounded-md px-3 py-1 text-muted-foreground hover:text-foreground'}>
                  {tab.label}
                </button>
              ))}
            </div>
          }
          notices={
            nodeTypes.isError || (!catalog && chatflowTab === 'canvas') || (validation && !validation.valid) ? (
              <>
                {/* Without the catalog nodes have no handles, so edges cannot be drawn: keep the canvas read-only until it loads. */}
                {nodeTypes.isError ? (
                  <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    <span>Không tải được catalog node: {errorMessage(nodeTypes.error)}. Sơ đồ chỉ xem cho tới khi tải được.</span>
                    <button type="button" className="underline" onClick={() => void nodeTypes.refetch()}>Thử lại</button>
                  </div>
                ) : !catalog ? (
                  <p role="status" className="text-sm text-muted-foreground">Đang tải catalog node…</p>
                ) : null}
                {validation && !validation.valid ? (
                  <IssuesPanel
                    state={validation}
                    onOpenSection={id => { if (!jsonError) { onChatflowOpen(false); onSection(id); } }}
                    workflow={validation.workflow ?? config.workflow as ChatflowWorkflow | undefined}
                    onOpenWorkflowIssue={() => { if (!jsonError) setChatflowTab('json'); }}
                  />
                ) : null}
              </>
            ) : null
          }
        >
          {/* Hidden, not unmounted: leaving the tab would abort the run and drop its trace. */}
          <div hidden={chatflowTab !== 'debug'} className="mx-auto h-full max-w-4xl overflow-y-auto">
            <DebugRunTab workflow={workflow} catalog={catalog} beforeRun={onBeforeDebugRun} visible={chatflowTab === 'debug'} />
          </div>
          {chatflowTab === 'debug' ? null : chatflowTab === 'json' ? (
            <div className="mx-auto h-full max-w-4xl overflow-y-auto">
              <WorkflowJsonTab
                workflow={config.workflow as Record<string, unknown> | undefined}
                onReplace={next => onChange(['workflow'], next)}
                onValidity={handleJsonValidity}
              />
            </div>
          ) : workflow ? (
            <WorkflowCanvas
              className="h-full w-full"
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
                  className="absolute inset-y-3 right-3 z-10 flex w-[min(440px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border bg-card shadow-xl animate-in fade-in slide-in-from-right-4 duration-200 motion-reduce:animate-none"
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
        </ChatflowEditor>
      )}
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <SectionNav
          active={section}
          onSelect={id => { onSection(id); if (id === 'chatflow' && !jsonError) onChatflowOpen(true); }}
          issues={issues}
          sections={visibleSections}
        />
        {/* The canvas needs the room; form sections keep a readable line length. */}
        <div className={section === 'chatflow' ? 'min-w-0' : 'max-w-3xl'}>
          {/* Hidden behind the open editor anyway; one canvas at a time. */}
          {section === 'chatflow' && !(chatflowOpen && mode === 'chatflow') && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-13 text-muted-foreground">Sơ đồ chatflow được sửa trong trình chỉnh sửa gần toàn màn hình.</p>
                <Button size="sm" onClick={() => onChatflowOpen(true)}>
                  <Maximize2 className="size-4" /> Mở trình chỉnh sửa
                </Button>
              </div>
              {workflow ? (
                <WorkflowCanvas className="h-[420px] w-full" workflow={workflow} catalog={catalog} issues={workflowIssues} readOnly showPalette={false} />
              ) : (
                <p className="rounded-lg border border-dashed p-6 text-13 text-muted-foreground">
                  {workflowMalformed ? 'Workflow chưa đúng cấu trúc, mở trình chỉnh sửa để sửa ở tab JSON.' : 'Bản nháp Chatflow chưa có workflow.'}
                </p>
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
