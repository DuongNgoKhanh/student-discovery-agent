'use client';

import { ArrowLeft } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { MetadataField } from '../types';
import type { MappingTarget } from './auto-map-columns';

export const BASE_TARGETS = [
  { key: 'document_id', label: 'Mã tài liệu' },
  { key: 'title', label: 'Tiêu đề' },
  { key: 'body', label: 'Nội dung' },
  { key: 'source_url', label: 'Nguồn' },
] as const;

export const metaKey = (name: string) => `meta:${name}`;

/** Every mapping target with the names a CSV column may use to match it automatically. */
export const mappingTargets = (fields: MetadataField[]): MappingTarget[] => [
  ...BASE_TARGETS.map(({ key, label }) => ({ key, names: [key, label] })),
  ...fields.map(field => ({ key: metaKey(field.name), names: [field.name, field.label] })),
];

// Radix Select items cannot carry an empty value.
const NONE = '__none__';

export interface ImportMappingStepProps {
  header: string[];
  sample: string[];
  fields: MetadataField[];
  mapping: Record<string, string>;
  onChange: (key: string, column: string | undefined) => void;
}

export function ImportMappingStep({ header, sample, fields, mapping, onChange }: ImportMappingStepProps) {
  const columns = [...new Set(header.filter(Boolean))];
  const sampleOf = (column: string | undefined) => (column === undefined ? '' : sample[header.indexOf(column)] ?? '');

  const row = (key: string, label: React.ReactNode) => {
    const id = `import-map-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const value = sampleOf(mapping[key]);
    return (
      <div key={key} className="grid grid-cols-1 items-center gap-2 py-2 sm:grid-cols-[minmax(0,12rem)_auto_minmax(0,16rem)_minmax(0,1fr)] sm:gap-3">
        <Label htmlFor={id} className="text-13 font-normal">{label}</Label>
        <ArrowLeft className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden />
        <Select value={mapping[key] ?? NONE} onValueChange={next => onChange(key, next === NONE ? undefined : next)}>
          <SelectTrigger id={id} className="h-8 text-13"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>(không ghép)</SelectItem>
            {columns.map(column => <SelectItem key={column} value={column}>{column}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="truncate text-13 text-muted-foreground" title={value || undefined}>
          {value && <><span className="sr-only">Ví dụ: </span>{value}</>}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border px-4 py-2">
        <div className="hidden gap-3 border-b pb-2 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[minmax(0,12rem)_auto_minmax(0,16rem)_minmax(0,1fr)]">
          <span>Trường đích</span><span aria-hidden className="w-4" /><span>Cột CSV</span><span>Giá trị mẫu</span>
        </div>
        <div className="divide-y">
          {BASE_TARGETS.map(({ key, label }) => row(key, label))}
          {fields.map(field => row(metaKey(field.name), (
            <>{field.label} <span className="font-mono text-xs text-muted-foreground">{field.name}</span></>
          )))}
        </div>
      </div>
      <p className="rounded-xl bg-sidebar px-4 py-3 text-13 text-muted-foreground">
        Tài liệu đã có: cột không ghép giữ giá trị cũ; ô rỗng trong cột được ghép sẽ xoá giá trị.
      </p>
    </div>
  );
}
