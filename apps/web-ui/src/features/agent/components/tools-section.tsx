'use client';

import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useKnowledgeBases } from '@/features/knowledge';
import { fieldId, getIn } from '../model/config';
import { TOOL_CATALOG, type ToolBinding } from '../model/tools';
import { Field, NumberField } from './field';
import type { SectionProps } from './persona-section';

type Binding = ToolBinding;

export function ToolsSection({ config, onChange, issues, onBindKb }: SectionProps & { onBindKb: (kb: string) => void }) {
  const tools = ((getIn(config, ['tools']) as Binding[] | undefined) ?? []);
  const indexOf = (name: string) => tools.findIndex(t => t.name === name);
  const setTools = (next: Binding[]) => onChange(['tools'], next);

  const toggle = (name: string, on: boolean) => {
    if (on) setTools([...tools, { name, version: 1, params: {} }]);
    else setTools(tools.filter(t => t.name !== name));
  };

  const bases = useKnowledgeBases();
  const unknown = tools.filter(t => !TOOL_CATALOG.some(c => c.name === t.name));

  return (
    <div className="space-y-4">
      {TOOL_CATALOG.map(tool => {
        const index = indexOf(tool.name);
        const on = index >= 0;
        return (
          <div key={tool.name} className="rounded-lg border p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{tool.label} <span className="font-mono text-xs text-muted-foreground">{tool.name}</span></p>
                <p className="text-13 text-muted-foreground">{tool.description}</p>
              </div>
              <Switch id={fieldId(['tools', index >= 0 ? index : tool.name])} aria-label={`Bật ${tool.label}`} checked={on} onCheckedChange={value => toggle(tool.name, value)} />
            </div>
            {on && tool.params === 'knowledge.search' && (
              <div className="mt-4 space-y-4">
                <Field path={['tools', index, 'params', 'knowledge_base_id']} label="Knowledge base" issues={issues}>
                  <select id={fieldId(['tools', index, 'params', 'knowledge_base_id'])} className="h-9 w-full max-w-sm rounded-md border bg-background px-2 text-sm"
                    value={String(getIn(config, ['tools', index, 'params', 'knowledge_base_id']) ?? '')} onChange={e => onBindKb(e.target.value)}>
                    <option value="" disabled>Chọn knowledge base</option>
                    {bases.data?.map(kb => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
                  </select>
                </Field>
                <NumberField path={['tools', index, 'params', 'top_k']} label="Số đoạn trả về (1–8)" value={getIn(config, ['tools', index, 'params', 'top_k'])} onChange={onChange} issues={issues} />
                <NumberField path={['tools', index, 'params', 'score_threshold']} label="Ngưỡng điểm (0–1)" step={0.05} value={getIn(config, ['tools', index, 'params', 'score_threshold'])} onChange={onChange} issues={issues} />
              </div>
            )}
            {on && (tool.params === 'json' || tool.params === 'knowledge.show') && (
              <ParamsJson path={['tools', index, 'params']} value={tools[index]!.params ?? {}} onChange={onChange} issues={issues} />
            )}
          </div>
        );
      })}
      {unknown.length > 0 && (
        <div role="note" className="rounded-lg border border-dashed p-4 text-13 text-muted-foreground">
          Tool chưa có trong danh mục (giữ nguyên, sửa ở tab JSON): {unknown.map(t => <code key={t.name} className="mr-2">{t.name}</code>)}
        </div>
      )}
    </div>
  );
}

function ParamsJson({ path, value, onChange, issues }: { path: (string | number)[]; value: unknown } & Pick<SectionProps, 'onChange' | 'issues'>) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(JSON.stringify(value, null, 2)), [value]);
  return (
    <Field path={path} label="Params (JSON)" issues={issues}>
      <Textarea id={fieldId(path)} rows={6} className="font-mono text-xs" value={text}
        onChange={e => {
          setText(e.target.value);
          try { onChange(path, JSON.parse(e.target.value)); setError(null); } catch (err) { setError((err as Error).message); }
        }} />
      {error && <p role="alert" className="text-xs text-destructive">JSON chưa hợp lệ: {error}</p>}
    </Field>
  );
}
