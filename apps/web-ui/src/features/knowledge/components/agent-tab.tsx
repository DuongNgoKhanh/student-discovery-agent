'use client';

import { AlertTriangle } from 'lucide-react';
import { useAgentParams } from '../hooks/use-knowledge';
import type { AgentParams } from '../types';
import { ErrorText } from './error-text';
import { JsonCode } from './json-code';
import { CopyButton } from './shared/copy-button';

const TOOLS = ['knowledge.search', 'knowledge.show'] as const satisfies readonly (keyof AgentParams)[];

export function AgentTab({ kb }: { kb: string }) {
  const { data, error } = useAgentParams(kb);
  // `warnings` explains adjustments for the admin; agent.json only takes the two param objects.
  const { warnings = [], ...params } = data ?? {};
  const json = data ? JSON.stringify(params, null, 2) : '';
  return (
    <div className="space-y-4 text-sm">
      <ol className="list-inside list-decimal space-y-1 text-13">
        <li>Mở <code className="font-mono">infra/local-releases/agent.json</code>.</li>
        <li>Thay params của <code className="font-mono">knowledge.search</code> và <code className="font-mono">knowledge.show</code> trong mảng <code className="font-mono">tools</code>.</li>
        <li>Mở hội thoại mới để thấy thay đổi.</li>
      </ol>
      <ErrorText error={error} />
      {warnings.length > 0 && (
        <div role="status" className="flex gap-2 rounded-xl bg-warning-subtle px-4 py-3 text-13 text-warning-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <ul className="space-y-1">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
        </div>
      )}
      {data && TOOLS.map(tool => (
        <div key={tool} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-13 font-medium">{tool}</span>
            <CopyButton value={JSON.stringify(data[tool], null, 2)} iconOnly variant="ghost" label={`Copy ${tool}`} className="h-8 w-8" />
          </div>
          <JsonCode value={data[tool]} />
        </div>
      ))}
      <CopyButton value={json} disabled={!data} variant="default" label="Copy cả hai" />
    </div>
  );
}
