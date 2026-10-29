'use client';

import { TagInput } from '@/features/knowledge';
import { fieldId, getIn } from '../model/config';
import { Field, TextAreaField } from './field';
import type { SectionProps } from './persona-section';

const TEMPLATES: [string, string][] = [
  ['unknown_message', 'Khi không hiểu ý'], ['busy_message', 'Khi hệ thống bận'], ['ask_name', 'Hỏi tên trước bài khám phá'],
  ['next_question', 'Chuyển sang câu tiếp theo'], ['clarification', 'Hỏi lại để làm rõ'], ['completed', 'Khi có kết quả'],
];

export function TemplatesSection({ config, onChange, issues }: SectionProps) {
  return (
    <div className="space-y-5">
      {TEMPLATES.map(([key, label]) => (
        <TextAreaField key={key} path={['templates', key]} label={label} rows={2} value={getIn(config, ['templates', key])} onChange={onChange} issues={issues} />
      ))}
      <Field path={['templates', 'fallback_suggestions']} label="Gợi ý dự phòng" issues={issues}>
        <TagInput id={fieldId(['templates', 'fallback_suggestions'])} label="Gợi ý dự phòng"
          value={(getIn(config, ['templates', 'fallback_suggestions']) as string[] | undefined) ?? []}
          onChange={value => onChange(['templates', 'fallback_suggestions'], value)} />
      </Field>
    </div>
  );
}
