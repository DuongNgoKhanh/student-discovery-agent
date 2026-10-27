'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAgentParams } from '../hooks/use-knowledge';
import { ErrorText } from './error-text';

export function AgentTab({ kb }: { kb: string }) {
  const { data, error } = useAgentParams(kb);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  // `warnings` explains adjustments for the admin; agent.json only takes the two param objects.
  const { warnings = [], ...params } = data ?? {};
  const json = data ? JSON.stringify(params, null, 2) : '';
  const copy = () => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard) { setCopyFailed(true); return; }
    clipboard.writeText(json).then(() => { setCopied(true); setCopyFailed(false); }, () => setCopyFailed(true));
  };
  return (
    <div className="space-y-3 text-sm">
      <p>
        Dán params dưới đây vào <code>prototypes/agent-chat/releases/agent.json</code>: <code>knowledge.search</code> và{' '}
        <code>knowledge.show</code> trong mảng <code>tools</code>. Chỉ hội thoại mới thấy thay đổi.
      </p>
      <ErrorText error={error} />
      {warnings.length > 0 && (
        <ul role="status" className="list-disc space-y-1 rounded-md bg-amber-50 p-3 pl-6 text-amber-800">
          {warnings.map(warning => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      <pre className="overflow-auto rounded-md bg-gray-50 p-3 text-xs">{json}</pre>
      <Button disabled={!data} onClick={copy}>{copied ? 'Đã copy' : 'Copy'}</Button>
      {copyFailed && <p role="alert" className="text-red-600">Không copy được, hãy chọn và copy thủ công.</p>}
    </div>
  );
}
