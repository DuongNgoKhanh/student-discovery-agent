'use client';

import { Switch } from '@/components/ui/switch';
import { TagInput } from '@/features/knowledge';
import { fieldId, getIn } from '../model/config';
import { Field, NumberField, TextAreaField } from './field';
import type { SectionProps } from './persona-section';

export function LimitsSection({ config, onChange, issues }: SectionProps) {
  const list = (path: (string | number)[]) => (getIn(config, path) as string[] | undefined) ?? [];
  return (
    <div className="space-y-5">
      <NumberField path={['limits', 'max_tool_steps']} label="Số bước tool tối đa mỗi lượt" value={getIn(config, ['limits', 'max_tool_steps'])} onChange={onChange} issues={issues} />
      <NumberField path={['limits', 'turn_timeout_ms']} label="Thời gian tối đa một lượt (ms)" value={getIn(config, ['limits', 'turn_timeout_ms'])} onChange={onChange} issues={issues} />
      <NumberField path={['limits', 'history_messages']} label="Số tin nhắn lịch sử gửi cho model" value={getIn(config, ['limits', 'history_messages'])} onChange={onChange} issues={issues} />
      <NumberField path={['limits', 'max_input_chars']} label="Độ dài tin nhắn tối đa của học sinh" value={getIn(config, ['limits', 'max_input_chars'])} onChange={onChange} issues={issues} />
      <Field path={['guardrails', 'enabled']} label="Từ chối chủ đề ngoài phạm vi" issues={issues}>
        <Switch id={fieldId(['guardrails', 'enabled'])} checked={getIn(config, ['guardrails', 'enabled']) === true}
          onCheckedChange={value => onChange(['guardrails', 'enabled'], value)} />
      </Field>
      <Field path={['guardrails', 'blocked_topics']} label="Chủ đề bị chặn" issues={issues}>
        <TagInput id={fieldId(['guardrails', 'blocked_topics'])} label="Chủ đề bị chặn" value={list(['guardrails', 'blocked_topics'])}
          onChange={value => onChange(['guardrails', 'blocked_topics'], value)} />
      </Field>
      <TextAreaField path={['guardrails', 'refusal_text']} label="Câu từ chối" rows={2} value={getIn(config, ['guardrails', 'refusal_text'])} onChange={onChange} issues={issues} />
      <Field path={['links', 'allowed_domains']} label="Domain được phép hiện link" issues={issues} hint="Ví dụ ihrd.vn (gồm cả subdomain).">
        <TagInput id={fieldId(['links', 'allowed_domains'])} label="Domain được phép" value={list(['links', 'allowed_domains'])}
          onChange={value => onChange(['links', 'allowed_domains'], value)} />
      </Field>
    </div>
  );
}
