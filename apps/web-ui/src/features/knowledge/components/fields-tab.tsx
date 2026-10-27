'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateField, useDeleteField, useFields, usePatchField } from '../hooks/use-knowledge';
import type { FieldType, MetadataField } from '../types';
import { ErrorText } from './error-text';

const TYPES: FieldType[] = ['string', 'number', 'time', 'string_list'];
type NewField = { name: string; type: FieldType; label: string; filterable: boolean; ordinal: number };

function FieldRow({ kb, field }: { kb: string; field: MetadataField }) {
  const patch = usePatchField();
  const remove = useDeleteField();
  const [label, setLabel] = useState(field.label);
  const [filterable, setFilterable] = useState(field.filterable);
  const [ordinal, setOrdinal] = useState(field.ordinal);
  return (
    <tr className="border-t align-top">
      <td>{field.name}</td>
      <td>{field.type}</td>
      <td><Input value={label} onChange={e => setLabel(e.target.value)} /></td>
      <td><input type="checkbox" checked={filterable} onChange={e => setFilterable(e.target.checked)} aria-label={`filterable ${field.name}`} /></td>
      <td><Input type="number" value={ordinal} onChange={e => setOrdinal(Number(e.target.value))} className="w-20" /></td>
      <td className="space-x-2">
        <Button size="sm" variant="outline" onClick={() => patch.mutate({ kb, name: field.name, body: { label, filterable, ordinal } })}>Lưu</Button>
        <Button size="sm" variant="destructive"
          onClick={() => { if (window.confirm(`Xoá field ${field.name}?`)) remove.mutate({ kb, name: field.name }); }}>Xoá</Button>
        <ErrorText error={patch.error ?? remove.error} />
      </td>
    </tr>
  );
}

export function FieldsTab({ kb }: { kb: string }) {
  const { data, isLoading, error } = useFields(kb);
  const create = useCreateField();
  const form = useForm<NewField>({ defaultValues: { name: '', type: 'string', label: '', filterable: false, ordinal: 0 } });
  const submit = form.handleSubmit(values => {
    create.mutate({ kb, body: { ...values, ordinal: Number(values.ordinal) } }, { onSuccess: () => form.reset() });
  });
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">Tên và kiểu field không đổi được sau khi tạo (agent.json tham chiếu theo tên).</p>
      {isLoading && <p>Đang tải...</p>}
      <ErrorText error={error} />
      <table className="w-full text-sm">
        <thead><tr className="text-left"><th>Tên</th><th>Kiểu</th><th>Label</th><th>Lọc được</th><th>Thứ tự</th><th /></tr></thead>
        <tbody>{data?.map(field => <FieldRow key={`${field.id}:${field.label}:${field.filterable}:${field.ordinal}`} kb={kb} field={field} />)}</tbody>
      </table>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded-md border p-3 text-sm">
        <Input className="w-40" placeholder="ten_field" {...form.register('name', { required: true })} />
        <select className="h-9 rounded-md border px-2" {...form.register('type')}>{TYPES.map(type => <option key={type}>{type}</option>)}</select>
        <Input className="w-40" placeholder="Label" {...form.register('label')} />
        <label className="flex items-center gap-1"><input type="checkbox" {...form.register('filterable')} /> Lọc được</label>
        <Input className="w-20" type="number" {...form.register('ordinal', { valueAsNumber: true })} />
        <Button type="submit" disabled={create.isPending}>Thêm field</Button>
        <ErrorText error={create.error} />
      </form>
    </div>
  );
}
