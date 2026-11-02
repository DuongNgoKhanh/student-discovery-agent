'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAgentParams } from '../hooks/use-knowledge';
import type { AgentParams } from '../types';
import { ErrorText } from './error-text';
import { JsonCode } from './json-code';
import { CopyButton } from './shared/copy-button';

const TOOLS = ['knowledge.search', 'knowledge.show'] as const satisfies readonly (keyof AgentParams)[];

export function AgentTab({ kb }: { kb: string }) {
  const { data, error } = useAgentParams(kb);
  // `warnings` explains adjustments for the admin; the agent only takes the two param objects.
  const { warnings = [], ...params } = data ?? {};
  const json = data ? JSON.stringify(params, null, 2) : '';
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3">
        <p className="text-13 text-muted-foreground">Bật công cụ tìm kiếm của agent với knowledge base này. Bạn kiểm tra và phát hành ở trang Agent.</p>
        <Button asChild size="sm"><Link href={`/admin/agent?section=tools&kb=${encodeURIComponent(kb)}`}>Gắn vào agent</Link></Button>
      </div>
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
