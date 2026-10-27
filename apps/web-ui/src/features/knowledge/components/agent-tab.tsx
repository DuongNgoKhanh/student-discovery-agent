'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAgentParams } from '../hooks/use-knowledge';
import { ErrorText } from './error-text';

export function AgentTab({ kb }: { kb: string }) {
  const { data, error } = useAgentParams(kb);
  const [copied, setCopied] = useState(false);
  const json = data ? JSON.stringify(data, null, 2) : '';
  return (
    <div className="space-y-3 text-sm">
      <p>
        Dán params dưới đây vào <code>prototypes/agent-chat/releases/agent.json</code>: <code>knowledge.search</code> và{' '}
        <code>knowledge.show</code> trong mảng <code>tools</code>. Chỉ hội thoại mới thấy thay đổi.
      </p>
      <ErrorText error={error} />
      <pre className="overflow-auto rounded-md bg-gray-50 p-3 text-xs">{json}</pre>
      <Button disabled={!data} onClick={() => void navigator.clipboard.writeText(json).then(() => setCopied(true))}>
        {copied ? 'Đã copy' : 'Copy'}
      </Button>
    </div>
  );
}
