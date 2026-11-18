'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import { errorMessage } from '@/features/knowledge';
import { streamDebugRun, type DebugRunEvent } from '../api/debug-run';
import type { WorkflowDebugRunRequest, WorkflowDebugRunResult } from '../types';

const EMPTY_OBJECT = '{}';

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
  const [message, setMessage] = useState('học phí MTU');
  const [inputMode, setInputMode] = useState<'message' | 'interaction'>('message');
  const [stateText, setStateText] = useState(EMPTY_OBJECT);
  const [stubsText, setStubsText] = useState(EMPTY_OBJECT);
  const [events, setEvents] = useState<DebugRunEvent[]>([]);
  const [result, setResult] = useState<WorkflowDebugRunResult | null>(null);
  const [delta, setDelta] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    let state: WorkflowDebugRunRequest['state'];
    let llmStubs: WorkflowDebugRunRequest['llm_stubs'];
    try {
      state = JSON.parse(stateText.trim() || EMPTY_OBJECT) as WorkflowDebugRunRequest['state'];
      llmStubs = JSON.parse(stubsText.trim() || EMPTY_OBJECT) as WorkflowDebugRunRequest['llm_stubs'];
      if (!state || typeof state !== 'object' || Array.isArray(state) || !llmStubs || typeof llmStubs !== 'object' || Array.isArray(llmStubs)) {
        throw new Error('State và LLM stubs phải là JSON object');
      }
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'JSON không hợp lệ');
      return;
    }

    const request: WorkflowDebugRunRequest = inputMode === 'message'
      ? { message: message.trim(), state, llm_stubs: llmStubs }
      : { interaction: { name: message.trim() }, state, llm_stubs: llmStubs };
    if (inputMode === 'message' && !request.message) { setError('Nhập message trước khi chạy'); return; }
    if (inputMode === 'interaction' && !message.trim()) { setError('Nhập tên interaction trước khi chạy'); return; }

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
        <div className="flex gap-2">
          <Button size="sm" disabled={running} onClick={() => void run()}>Chạy</Button>
          {running && <Button size="sm" variant="outline" onClick={() => abortRef.current?.abort()}>Dừng</Button>}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs">Input
          <div className="flex gap-2"><select aria-label="Loại input" className="rounded-md border bg-background px-2" value={inputMode} onChange={event => setInputMode(event.target.value as typeof inputMode)}><option value="message">Message</option><option value="interaction">Interaction</option></select><input aria-label="Nội dung input" className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5" value={message} onChange={event => setMessage(event.target.value)} /></div>
        </label>
        <JsonInput label="State giả lập" value={stateText} onChange={setStateText} />
        <JsonInput label="LLM stubs (tuỳ chọn)" value={stubsText} onChange={setStubsText} />
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</p>}
      {events.length > 0 && <ol aria-label="Tiến trình node" className="space-y-1 text-xs">{events.filter(event => event.event !== 'delta').map((event, index) => <li key={`${event.event}-${index}`} className="font-mono">{event.event}{'node_id' in event ? ` · ${event.node_id}` : ''}</li>)}</ol>}
      {delta && <pre className="max-h-28 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">{delta}</pre>}
      {result && <div className="space-y-1"><p className="text-xs">Run <code>{result.run_id}</code> · {result.status} · {result.path.length} node · {result.live_llm_calls} live LLM</p><pre className="max-h-56 overflow-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(result, null, 2)}</pre></div>}
    </section>
  );
}

function JsonInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="space-y-1 text-xs">{label}<textarea aria-label={label} className="block h-20 w-full resize-y rounded-md border bg-background p-2 font-mono text-xs" value={value} onChange={event => onChange(event.target.value)} /></label>;
}
