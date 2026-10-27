'use client';

import { useAgentParams } from '../hooks/use-knowledge';
import { ErrorText } from './error-text';
import { CopyButton } from './shared/copy-button';

export function AgentTab({ kb }: { kb: string }) {
  const { data, error } = useAgentParams(kb);
  // `warnings` explains adjustments for the admin; agent.json only takes the two param objects.
  const { warnings = [], ...params } = data ?? {};
  const json = data ? JSON.stringify(params, null, 2) : '';
  return (
    <div className="space-y-3 text-sm">
      <p>
        Dán params dưới đây vào <code>prototypes/agent-chat/releases/agent.json</code>: <code>knowledge.search</code> và{' '}
        <code>knowledge.show</code> trong mảng <code>tools</code>. Chỉ hội thoại mới thấy thay đổi.
      </p>
      <ErrorText error={error} />
      {warnings.length > 0 && (
        <ul role="status" className="list-disc space-y-1 rounded-md bg-warning-subtle p-3 pl-6 text-warning-foreground">
          {warnings.map(warning => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      <pre className="overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{json}</pre>
      <CopyButton value={json} disabled={!data} variant="default" />
    </div>
  );
}
