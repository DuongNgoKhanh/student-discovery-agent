'use client';

import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils/cn';
import { useCreateField } from '../hooks/use-knowledge';
import type { FieldType } from '../types';
import { errorMessage } from './shared/error-message';
import { slugify } from './shared/format';

export const FIELD_TYPES: Record<FieldType, { label: string; example: string }> = {
  string: { label: 'chuỗi', example: 'VD: HUTECH' },
  number: { label: 'số', example: 'VD: 25000000' },
  time: { label: 'thời gian', example: 'VD: 2026-10-27' },
  string_list: { label: 'danh sách', example: 'VD: CNTT, Kinh tế' },
};

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** Field names use `_` and must start with a letter: "Học phí 2026" → "hoc_phi_2026". */
export function fieldName(label: string): string {
  return slugify(label).replace(/-/g, '_').replace(/^[^a-z]+/, '').slice(0, 64).replace(/_+$/, '');
}

type NewField = { label: string; name: string; type: FieldType; filterable: boolean };

export function MetadataFieldForm({ kb, ordinal, onDone }: { kb: string; ordinal: number; onDone: () => void }) {
  const create = useCreateField();
  const [nameEdited, setNameEdited] = useState(false);
  const form = useForm<NewField>({ defaultValues: { label: '', name: '', type: 'string', filterable: false } });
  const { errors } = form.formState;
  const type = form.watch('type');

  const submit = form.handleSubmit(async values => {
    try {
      const field = await create.mutateAsync({
        kb, body: { name: values.name, type: values.type, label: values.label.trim(), filterable: values.filterable, ordinal },
      });
      toast.success(`Đã thêm trường "${field.label || field.name}"`);
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.httpStatus === 409) form.setError('name', { message: 'Đã có trường tên này, hãy chọn tên khác.' });
      else form.setError('root', { message: errorMessage(error) });
    }
  });

  const label = form.register('label', {
    validate: value => value.trim() !== '' || 'Nhập label.',
    onChange: event => { if (!nameEdited) form.setValue('name', fieldName(event.target.value), { shouldValidate: form.formState.isSubmitted }); },
  });
  const name = form.register('name', {
    validate: value => NAME_PATTERN.test(value) || 'Bắt đầu bằng chữ a-z, chỉ dùng a-z, 0-9 và "_", tối đa 64 ký tự.',
    onChange: () => setNameEdited(true),
  });

  return (
    <form onSubmit={submit} noValidate aria-label="Thêm trường" className="space-y-3 rounded-xl border p-4">
      <div className="space-y-1.5">
        <Label htmlFor="field-label">Label</Label>
        <Input id="field-label" autoFocus placeholder="VD: Học phí" maxLength={200} aria-invalid={!!errors.label}
          aria-describedby={errors.label ? 'field-label-error' : undefined} {...label} />
        {errors.label && <p id="field-label-error" className="text-xs text-destructive">{errors.label.message}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="field-name">Tên kỹ thuật</Label>
        <Input id="field-name" className="font-mono" placeholder="hoc_phi" aria-invalid={!!errors.name} aria-describedby="field-name-hint" {...name} />
        <p id="field-name-hint" className={cn('text-xs', errors.name ? 'text-destructive' : 'text-muted-foreground')}>
          {errors.name?.message ?? 'Agent và bộ lọc tham chiếu trường theo tên này.'}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="field-type">Kiểu</Label>
        <Controller control={form.control} name="type" render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger id="field-type" aria-describedby="field-type-hint"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(FIELD_TYPES).map(([value, info]) => <SelectItem key={value} value={value}>{info.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )} />
        <p id="field-type-hint" className="text-xs text-muted-foreground">{FIELD_TYPES[type].example}</p>
      </div>
      <div className="flex items-center gap-2">
        <Controller control={form.control} name="filterable" render={({ field }) => (
          <Switch id="field-filterable" checked={field.value} onCheckedChange={field.onChange} />
        )} />
        <Label htmlFor="field-filterable" className="font-normal">Lọc được</Label>
      </div>
      <p className="text-xs text-muted-foreground">Tên và kiểu không đổi được sau khi tạo.</p>
      {errors.root && <p role="alert" className="text-sm text-destructive">{errors.root.message}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>Huỷ</Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>Thêm</Button>
      </div>
    </form>
  );
}
