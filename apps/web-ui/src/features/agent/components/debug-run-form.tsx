'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { WorkflowDebugRunRequest } from '../types';

const EMPTY_OBJECT = '{}';

interface DebugRunFormProps {
  onSubmit: (request: WorkflowDebugRunRequest) => void | Promise<void>;
  onCancel?: () => void;
  running?: boolean;
}

export function DebugRunForm({ onSubmit, onCancel, running = false }: DebugRunFormProps) {
  const [input, setInput] = useState('học phí MTU');
  const [inputMode, setInputMode] = useState<'message' | 'interaction'>('message');
  const [optionId, setOptionId] = useState('');
  const [stateText, setStateText] = useState(EMPTY_OBJECT);
  const [stubsText, setStubsText] = useState(EMPTY_OBJECT);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const value = input.trim();
    if (!value) {
      setError(inputMode === 'message' ? 'Nhập message trước khi chạy' : 'Nhập action của interaction trước khi chạy');
      return;
    }

    let state: WorkflowDebugRunRequest['state'];
    let llmStubs: WorkflowDebugRunRequest['llm_stubs'];
    try {
      state = JSON.parse(stateText.trim() || EMPTY_OBJECT) as WorkflowDebugRunRequest['state'];
      llmStubs = JSON.parse(stubsText.trim() || EMPTY_OBJECT) as WorkflowDebugRunRequest['llm_stubs'];
      if (
        !state ||
        typeof state !== 'object' ||
        Array.isArray(state) ||
        !llmStubs ||
        typeof llmStubs !== 'object' ||
        Array.isArray(llmStubs)
      ) {
        throw new Error('State và LLM stubs phải là JSON object');
      }
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'JSON không hợp lệ');
      return;
    }

    setError(null);
    const request: WorkflowDebugRunRequest = inputMode === 'message'
      ? { message: value, state, llm_stubs: llmStubs }
      : { interaction: { action: value, ...(optionId.trim() ? { option_id: optionId.trim() } : {}) }, state, llm_stubs: llmStubs };
    void onSubmit(request);
  };

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs">
          Input
          <div className="flex gap-2">
            <select
              aria-label="Loại input"
              className="rounded-md border bg-background px-2"
              value={inputMode}
              onChange={event => setInputMode(event.target.value as typeof inputMode)}
              disabled={running}
            >
              <option value="message">Message</option>
              <option value="interaction">Interaction</option>
            </select>
            <input
              aria-label="Nội dung input"
              className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5"
              placeholder={inputMode === 'message' ? 'Tin nhắn của học sinh' : 'action, ví dụ confirm_answer'}
              value={input}
              onChange={event => setInput(event.target.value)}
              disabled={running}
            />
          </div>
          {inputMode === 'interaction' && (
            <input
              aria-label="option_id (tuỳ chọn)"
              className="mt-2 w-full rounded-md border bg-background px-2 py-1.5"
              placeholder="option_id (tuỳ chọn)"
              value={optionId}
              onChange={event => setOptionId(event.target.value)}
              disabled={running}
            />
          )}
        </label>
        <JsonInput label="State giả lập" value={stateText} onChange={setStateText} disabled={running} />
        <JsonInput label="LLM stubs (tuỳ chọn)" value={stubsText} onChange={setStubsText} disabled={running} />
      </div>
      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={running} onClick={submit}>Chạy</Button>
        {running && onCancel && <Button size="sm" variant="outline" onClick={onCancel}>Dừng</Button>}
      </div>
    </>
  );
}

function JsonInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean }) {
  return (
    <label className="space-y-1 text-xs">
      {label}
      <textarea
        aria-label={label}
        className="block h-20 w-full resize-y rounded-md border bg-background p-2 font-mono text-xs"
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
      />
    </label>
  );
}
