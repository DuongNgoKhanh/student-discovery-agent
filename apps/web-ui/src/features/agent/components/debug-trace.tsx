'use client';

import type { WorkflowDebugNodeRun, WorkflowDebugRunResult } from '../types';

interface DebugTraceProps {
  result: WorkflowDebugRunResult;
  /** Reason from Studio's trailing `run_not_saved` frame: the run id will not resolve later. */
  notSavedReason?: string | null;
}

export function DebugTrace({ result, notSavedReason = null }: DebugTraceProps) {
  return (
    <section aria-label="Trace chạy thử" className="space-y-4 rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Trace chạy thử</h3>
        <p className="text-xs text-muted-foreground">
          Run <code>{result.run_id}</code>{notSavedReason ? ' (chưa lưu)' : ''} · trạng thái: <strong>{result.status}</strong>
        </p>
      </div>

      {notSavedReason && (
        <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
          Lần chạy này không được lưu ({notSavedReason}): trace chỉ còn ở màn hình này, mở lại theo run id sẽ không tìm thấy.
        </p>
      )}

      {result.fallback_reason && (
        <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
          Fallback: {result.fallback_reason}
        </p>
      )}

      <div>
        <h4 className="text-xs font-semibold">Đường đi workflow</h4>
        <ol aria-label="Đường đi workflow" className="mt-1 flex flex-wrap gap-1 text-xs">
          {result.path.map((nodeId, index) => (
            <li key={`${nodeId}-${index}`} className="rounded bg-muted px-2 py-1 font-mono">
              {index > 0 && <span aria-hidden="true" className="mr-1">→</span>}
              {nodeId}
            </li>
          ))}
        </ol>
      </div>

      <div className="space-y-2" aria-label="Chi tiết từng node">
        <h4 className="text-xs font-semibold">Chi tiết từng node</h4>
        {result.node_runs.map(node => <NodeRun key={`${node.order}-${node.node_id}`} node={node} />)}
      </div>

      <TraceTotals result={result} />

      <TraceCollection label="Blocks" items={result.blocks} />
      <TraceCollection label="Effects (dry-run)" items={result.effects} />
    </section>
  );
}

function NodeRun({ node }: { node: WorkflowDebugNodeRun }) {
  return (
    <article aria-label={`Node ${node.node_id}`} className="space-y-2 rounded-md border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h5 className="font-semibold">{node.order}. {node.node_id}</h5>
        <span className="text-muted-foreground">{node.type}</span>
      </div>

      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        <Metric label="Handle" value={node.handle ?? '—'} />
        <Metric label="Thời gian" value={`${node.duration_ms} ms`} />
        <Metric label="LLM calls" value={String(node.llm_calls)} />
        <Metric label="Tokens" value={`input ${node.tokens.input} · output ${node.tokens.output}`} />
      </div>

      {node.reason !== undefined && <JsonField label="Lý do rẽ nhánh" value={node.reason} />}
      {node.input !== undefined && <JsonField label="Input" value={node.input} />}
      {node.output !== undefined && <JsonField label="Output" value={node.output} />}
      {node.refs && node.refs.length > 0 && <Metric label="Refs" value={node.refs.join(', ')} />}
      {node.error && <p role="alert" className="rounded border border-destructive/30 bg-destructive/5 p-2 text-destructive">Lỗi: {node.error}</p>}
    </article>
  );
}

function TraceTotals({ result }: { result: WorkflowDebugRunResult }) {
  return (
    <div aria-label="Tổng kết trace" className="grid gap-2 rounded-md bg-muted p-3 text-xs sm:grid-cols-4">
      <Metric label="Tổng LLM calls" value={String(result.llm_calls)} />
      <Metric label="Live LLM calls" value={String(result.live_llm_calls)} />
      <Metric label="Tokens input" value={String(result.tokens.input)} />
      <Metric label="Tokens output" value={String(result.tokens.output)} />
    </div>
  );
}

function TraceCollection({ label, items }: { label: string; items: unknown[] }) {
  return (
    <details className="rounded-md border p-2 text-xs">
      <summary className="cursor-pointer font-semibold">{label} ({items.length})</summary>
      {items.length > 0 && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">{formatJson(items)}</pre>}
    </details>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <p><span className="text-muted-foreground">{label}:</span> {value}</p>;
}

function JsonField({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">{formatJson(value)}</pre>
    </div>
  );
}

function formatJson(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}
