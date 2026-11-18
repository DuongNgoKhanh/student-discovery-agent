'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/errors';
import { errorMessage } from '@/features/knowledge';
import { streamDebugRun, type DebugRunEvent } from '../api/debug-run';
import type { WorkflowDebugRunRequest, WorkflowDebugRunResult } from '../types';
import { DebugRunForm } from './debug-run-form';

function formatRunError(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = (err.details as { issues?: Array<{ path?: string; message?: string }> } | undefined)?.issues;
    if (Array.isArray(issues) && issues.length > 0) {
      const summary = issues.map(issue => (issue.path ? `${issue.path}: ${issue.message ?? ''}` : issue.message ?? '')).filter(Boolean).join('; ');
      if (summary) return `${errorMessage(err)} (${summary})`;
    }
  }
  return errorMessage(err);
}

export function DebugRunPanel({ beforeRun }: { beforeRun?: () => Promise<boolean> }) {
  const [events, setEvents] = useState<DebugRunEvent[]>([]);
  const [result, setResult] = useState<WorkflowDebugRunResult | null>(null);
  const [delta, setDelta] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async (request: WorkflowDebugRunRequest) => {
    setRunning(true); setError(null); setEvents([]); setResult(null); setDelta('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (beforeRun && !(await beforeRun())) throw new Error('Không thể lưu bản nháp trước khi chạy thử');
      for await (const event of streamDebugRun(request, controller.signal)) {
        setEvents(current => [...current, event]);
        if (event.event === 'delta') setDelta(current => current + event.text);
        if (event.event === 'completed') setResult(event.result);
      }
    } catch (runError) {
      const aborted = (runError instanceof DOMException || runError instanceof Error) && runError.name === 'AbortError';
      if (!aborted) setError(formatRunError(runError));
    } finally { abortRef.current = null; setRunning(false); }
  };

  return (
    <section aria-label="Chạy thử Chatflow" className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-sm font-semibold">Chạy thử</h3><p className="text-xs text-muted-foreground">Dry-run draft hiện tại, không ghi dữ liệu thật.</p></div>
      </div>
      <DebugRunForm onSubmit={run} running={running} onCancel={() => abortRef.current?.abort()} />
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</p>}
      {events.length > 0 && <ol aria-label="Tiến trình node" className="space-y-1 text-xs">{events.filter(event => event.event !== 'delta').map((event, index) => <li key={`${event.event}-${index}`} className="font-mono">{event.event}{'node_id' in event ? ` · ${event.node_id}` : ''}</li>)}</ol>}
      {delta && <pre className="max-h-28 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">{delta}</pre>}
      {result && <div className="space-y-1"><p className="text-xs">Run <code>{result.run_id}</code> · {result.status} · {result.path.length} node · {result.live_llm_calls} live LLM</p><pre className="max-h-56 overflow-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(result, null, 2)}</pre></div>}
    </section>
  );
}
