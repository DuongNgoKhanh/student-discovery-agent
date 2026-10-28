'use client';

import { getIn } from '../model/config';
import { NumberField, TextField } from './field';
import type { SectionProps } from './persona-section';

export function ModelSection({ config, onChange, issues }: SectionProps) {
  const timeout = getIn(config, ['model', 'timeout_ms']);
  const retries = getIn(config, ['model', 'max_retries']);
  const turn = getIn(config, ['limits', 'turn_timeout_ms']);
  // Mirrors the runtime rule roughly (backoff ignored); the runtime check stays authoritative.
  const tooSlow = typeof timeout === 'number' && typeof retries === 'number' && typeof turn === 'number' && timeout * (retries + 1) > turn;
  return (
    <div className="space-y-5">
      <TextField path={['model', 'ref']} label="Model" value={getIn(config, ['model', 'ref'])} onChange={onChange} issues={issues}
        hint="Dạng provider/model, ví dụ gemini/gemini-2.5-flash. Provider: gemini, openai, vllm." />
      <NumberField path={['model', 'temperature']} label="Temperature (0–2)" step={0.1} value={getIn(config, ['model', 'temperature'])} onChange={onChange} issues={issues} />
      <NumberField path={['model', 'max_output_tokens']} label="Số token tối đa mỗi câu trả lời" value={getIn(config, ['model', 'max_output_tokens'])} onChange={onChange} issues={issues} />
      <NumberField path={['model', 'timeout_ms']} label="Timeout mỗi lần gọi (ms)" value={timeout} onChange={onChange} issues={issues} />
      <NumberField path={['model', 'max_retries']} label="Số lần thử lại" value={retries} onChange={onChange} issues={issues} />
      {tooSlow && (
        <p role="status" className="rounded-md bg-warning-subtle px-3 py-2 text-13 text-warning-foreground">
          Timeout × số lần thử có thể vượt giới hạn thời gian một lượt ({String(turn)} ms) ở nhóm Giới hạn.
        </p>
      )}
    </div>
  );
}
