'use client';

import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { fieldId, type Path } from '../model/config';
import type { AgentIssue } from '../types';

export interface FieldProps { path: Path; label: string; hint?: ReactNode; issues: AgentIssue[]; children?: ReactNode }

/** Label + hint + runtime issues for one config path; the control inside must use `fieldId(path)` as its id. */
export function Field({ path, label, hint, issues, children }: FieldProps) {
  const id = fieldId(path);
  const mine = issues.filter(issue => fieldId(issue.path) === id);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-13">{label}</Label>
      {children}
      {hint && !mine.length && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {mine.map(issue => <p key={issue.code + issue.path} role="alert" className="text-xs text-destructive">{issue.message}</p>)}
    </div>
  );
}

type Change = (path: Path, value: unknown) => void;

export function TextField({ path, label, hint, value, onChange, issues }: Omit<FieldProps, 'children'> & { value: unknown; onChange: Change }) {
  return (
    <Field path={path} label={label} hint={hint} issues={issues}>
      <Input id={fieldId(path)} value={typeof value === 'string' ? value : ''} onChange={e => onChange(path, e.target.value)} />
    </Field>
  );
}

export function TextAreaField({ path, label, hint, value, onChange, issues, rows = 4 }: Omit<FieldProps, 'children'> & { value: unknown; onChange: Change; rows?: number }) {
  const text = typeof value === 'string' ? value : '';
  return (
    <Field path={path} label={label} hint={<>{hint} <span className="tabular-nums">{text.length} ký tự</span></>} issues={issues}>
      <Textarea id={fieldId(path)} rows={rows} value={text} onChange={e => onChange(path, e.target.value)} />
    </Field>
  );
}

export function NumberField({ path, label, hint, value, onChange, issues, step = 1 }: Omit<FieldProps, 'children'> & { value: unknown; onChange: Change; step?: number }) {
  return (
    <Field path={path} label={label} hint={hint} issues={issues}>
      <Input id={fieldId(path)} type="number" step={step} value={typeof value === 'number' ? value : ''}
        onChange={e => onChange(path, e.target.value === '' ? undefined : Number(e.target.value))} className="max-w-40" />
    </Field>
  );
}
