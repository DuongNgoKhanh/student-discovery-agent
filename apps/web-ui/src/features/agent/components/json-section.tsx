'use client';

import { useEffect, useRef, useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { canonical } from '../model/config';
import type { AgentConfig } from '../types';

function locate(text: string, error: unknown): string {
  const match = /position (\d+)/.exec(String((error as Error).message));
  if (!match) return String((error as Error).message);
  const before = text.slice(0, Number(match[1]));
  const line = before.split('\n').length;
  return `dòng ${line}, cột ${before.length - before.lastIndexOf('\n')}`;
}

/** Shared JSON object textarea editor that reports syntax errors to block unsafe navigation/saves. */
export function JsonObjectEditor({
  value, onReplace, onValidity, id = 'field-', ariaLabel = 'Cấu hình JSON',
  notObjectMessage = 'Cấu hình phải là một JSON object', readOnly = false,
}: {
  value: Record<string, unknown>;
  onReplace: (next: Record<string, unknown>) => void;
  onValidity: (error: string | null) => void;
  id?: string;
  ariaLabel?: string;
  notObjectMessage?: string;
  readOnly?: boolean;
}) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  const lastCanonical = useRef(canonical(value));

  useEffect(() => {
    const nextCanonical = canonical(value);
    if (!error && nextCanonical !== lastCanonical.current) {
      lastCanonical.current = nextCanonical;
      setText(JSON.stringify(value, null, 2));
    }
  }, [value, error]);

  // Leaving the tab must not leave the page believing the JSON is still broken.
  useEffect(() => () => onValidity(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      <Textarea
        id={id}
        aria-label={ariaLabel}
        rows={28}
        spellCheck={false}
        readOnly={readOnly}
        className="font-mono text-xs"
        value={text}
        onChange={e => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(notObjectMessage);
            lastCanonical.current = canonical(parsed);
            setError(null);
            onValidity(null);
            onReplace(parsed as Record<string, unknown>);
          } catch (err) {
            const message = `JSON chưa hợp lệ (${locate(e.target.value, err)})`;
            setError(message);
            onValidity(message);
          }
        }}
      />
      {error && <p role="alert" className="text-13 text-destructive">{error}</p>}
    </div>
  );
}

/** Whole-config editor sharing the form state; reports `invalid` so the page can block leaving the tab. */
export function JsonSection({ config, onReplace, onValidity }: {
  config: AgentConfig; onReplace: (next: AgentConfig) => void; onValidity: (error: string | null) => void;
}) {
  return <JsonObjectEditor value={config} onReplace={onReplace} onValidity={onValidity} />;
}
