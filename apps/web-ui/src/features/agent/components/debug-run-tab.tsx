'use client';

import { useMemo } from 'react';
import type { ChatflowWorkflow, NodeTypeCatalog } from '../types';
import { useDebugRun } from '../hooks/use-debug-run';
import { DebugRunForm } from './debug-run-form';
import { DebugTrace } from './debug-trace';
import { WorkflowCanvas } from './workflow-canvas';

export function DebugRunTab({ workflow, catalog, beforeRun, visible = true }: {
  workflow?: ChatflowWorkflow;
  catalog?: NodeTypeCatalog;
  beforeRun?: () => Promise<boolean>;
  /** The editor keeps this tab mounted while hidden so a run survives a tab switch. */
  visible?: boolean;
}) {
  const debug = useDebugRun(beforeRun);
  // Memoized so streamed answer text does not hand the canvas a new path, and a full re-layout, per token.
  const livePath = useMemo(() => debug.result?.path ?? debug.events
    .filter(event => event.event === 'workflow.node_started')
    .map(event => event.node_id), [debug.result, debug.events]);
  const activeNodeId = useMemo(() => (debug.running ? activeNode(debug.events) : null), [debug.running, debug.events]);

  return (
    <section aria-label="Chạy thử Chatflow" className="space-y-3">
      <div className="rounded-lg border bg-card p-3">
        <div className="mb-3">
          <h3 className="text-sm font-semibold">Chạy thử</h3>
          <p className="text-xs text-muted-foreground">Dry-run draft hiện tại, không ghi dữ liệu thật.</p>
        </div>
        <DebugRunForm onSubmit={debug.run} running={debug.running} onCancel={debug.cancel} />
      </div>

      {debug.error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{debug.error}</p>}
      {debug.events.length > 0 && (
        <ol aria-label="Tiến trình node" className="space-y-1 rounded-lg border p-3 text-xs">
          {debug.events.filter(event => event.event !== 'delta').map((event, index) => (
            <li key={`${event.event}-${index}`} className="font-mono">{event.event}{'node_id' in event ? ` · ${event.node_id}` : ''}</li>
          ))}
        </ol>
      )}
      {debug.delta && <pre className="max-h-28 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">{debug.delta}</pre>}

      {/* A canvas laid out while hidden has no size; remount it when the tab is shown again. */}
      {visible && workflow && catalog && (livePath.length > 0 || debug.running) && (
        <div className="h-[360px] rounded-lg border p-1" aria-label="Đường đi đang chạy">
          <WorkflowCanvas
            className="h-full w-full"
            workflow={workflow}
            catalog={catalog}
            readOnly
            highlightedPath={livePath}
            activeNodeId={activeNodeId}
          />
        </div>
      )}

      {debug.result && <DebugTrace result={debug.result} notSavedReason={debug.notSavedReason} />}
      {!workflow && !debug.error && <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">Workflow chưa có để chạy thử.</p>}
    </section>
  );
}

/** The most recently started node that has not finished; a node revisited in a loop counts once per visit. */
export function activeNode(events: ReturnType<typeof useDebugRun>['events']): string | null {
  const open: string[] = [];
  for (const event of events) {
    if (event.event === 'workflow.node_started') open.push(event.node_id);
    if (event.event === 'workflow.node_finished') {
      const index = open.lastIndexOf(event.node_id);
      if (index !== -1) open.splice(index, 1);
    }
  }
  return open.at(-1) ?? null;
}

