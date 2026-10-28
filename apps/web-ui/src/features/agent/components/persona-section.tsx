'use client';

import { TagInput } from '@/features/knowledge';
import { fieldId, getIn, type Path } from '../model/config';
import type { AgentConfig, AgentIssue } from '../types';
import { Field, TextAreaField, TextField } from './field';

export interface SectionProps { config: AgentConfig; onChange: (path: Path, value: unknown) => void; issues: AgentIssue[] }

export function PersonaSection({ config, onChange, issues }: SectionProps) {
  const suggestions = (getIn(config, ['greeting_suggestions']) as string[] | undefined) ?? [];
  return (
    <div className="space-y-5">
      <TextAreaField path={['greeting_text']} label="Lời chào" rows={2} value={getIn(config, ['greeting_text'])} onChange={onChange} issues={issues}
        hint="Câu đầu tiên học sinh thấy khi mở hội thoại." />
      <Field path={['greeting_suggestions']} label="Gợi ý dưới lời chào" issues={issues} hint="Tối đa 4 gợi ý, mỗi gợi ý ≤ 60 ký tự.">
        <TagInput id={fieldId(['greeting_suggestions'])} label="Gợi ý dưới lời chào" value={suggestions}
          onChange={value => onChange(['greeting_suggestions'], value)} />
      </Field>
      <TextField path={['persona', 'name']} label="Tên agent" value={getIn(config, ['persona', 'name'])} onChange={onChange} issues={issues} />
      <TextAreaField path={['persona', 'system_prompt']} label="System prompt" rows={14} value={getIn(config, ['persona', 'system_prompt'])}
        onChange={onChange} issues={issues} hint={<>Dùng <code>{'{{display_name}}'}</code> để chèn tên học sinh.</>} />
    </div>
  );
}
