'use client';

import { useEffect, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import type { AgentConfig } from '../types';

function locate(text: string, error: unknown): string {
  const match = /position (\d+)/.exec(String((error as Error).message));
  if (!match) return String((error as Error).message);
  const before = text.slice(0, Number(match[1]));
  const line = before.split('\n').length;
  return `dòng ${line}, cột ${before.length - before.lastIndexOf('\n')}`;
}

/** Whole-config editor sharing the form state; reports `invalid` so the page can block leaving the tab. */
export function JsonSection({ config, onReplace, onValidity }: {
  config: AgentConfig; onReplace: (next: AgentConfig) => void; onValidity: (error: string | null) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(config, null, 2));
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!error) setText(JSON.stringify(config, null, 2)); }, [config]);
  return (
    <div className="space-y-2">
      <Textarea id="field-" aria-label="Cấu hình JSON" rows={28} spellCheck={false} className="font-mono text-xs" value={text}
        onChange={e => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Cấu hình phải là một JSON object');
            setError(null); onValidity(null); onReplace(parsed);
          } catch (err) {
            const message = `JSON chưa hợp lệ (${locate(e.target.value, err)})`;
            setError(message); onValidity(message);
          }
        }} />
      {error && <p role="alert" className="text-13 text-destructive">{error}</p>}
    </div>
  );
}
