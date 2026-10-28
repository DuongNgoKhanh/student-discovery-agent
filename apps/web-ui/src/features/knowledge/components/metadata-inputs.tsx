'use client';

import { useController, type Control } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import type { MetadataField } from '../types';
import type { EditorForm } from './document-editor-form';
import { displayValue, fromDateTimeLocal, joinList, splitList, toDateTimeLocal } from './metadata-form';
import { TagInput } from './tag-input';

export const metadataInputId = (name: string) => `doc-meta-${name}`;
export const fieldLabel = (field: MetadataField) => field.label || field.name;

interface EditorProps {
  field: MetadataField;
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
  invalid: boolean;
  describedBy?: string;
}

/** One input per field type; every value stays a form string so metadata-form.ts owns the conversion. */
function MetadataValueEditor({ field, value, onChange, onDone, invalid, describedBy }: EditorProps) {
  const common = {
    id: metadataInputId(field.name), 'aria-label': fieldLabel(field), 'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy, autoFocus: true, onBlur: onDone, className: 'h-8 text-13',
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); onDone(); }
    },
  };
  if (field.type === 'string_list') {
    return (
      <TagInput
        id={common.id} label={common['aria-label']} autoFocus invalid={invalid} describedBy={describedBy} className="text-13"
        value={splitList(value)} onChange={tags => onChange(joinList(tags))} onDone={onDone}
      />
    );
  }
  if (field.type === 'time') {
    const local = toDateTimeLocal(value);
    // Seconds or a UTC offset would be lost in datetime-local, so such values stay in a text input.
    if (local !== null) {
      return <Input type="datetime-local" {...common} value={local} onChange={event => onChange(fromDateTimeLocal(event.target.value))} />;
    }
    return <Input {...common} value={value} placeholder="2026-03-01T10:00:00+07:00" onChange={event => onChange(event.target.value)} />;
  }
  return (
    <Input
      {...common} inputMode={field.type === 'number' ? 'decimal' : undefined}
      value={value} onChange={event => onChange(event.target.value)}
    />
  );
}

function MetadataRow({ field, control, editing, onEdit, onDone }: {
  field: MetadataField; control: Control<EditorForm>; editing: boolean; onEdit: () => void; onDone: () => void;
}) {
  const { field: input, fieldState } = useController({ control, name: `metadata.${field.name}` });
  const value = input.value ?? '';
  const display = displayValue(field, value);
  const errorId = fieldState.error ? `${metadataInputId(field.name)}-error` : undefined;
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-2">
      <dt className="truncate pt-1.5 text-13 text-muted-foreground" title={field.name}>{fieldLabel(field)}</dt>
      <dd className="min-w-0">
        {editing
          ? (
            <MetadataValueEditor
              field={field} value={value} onChange={input.onChange} invalid={!!fieldState.error} describedBy={errorId}
              onDone={() => { input.onBlur(); onDone(); }}
            />
          )
          : (
            <button
              type="button" onClick={onEdit} title="Bấm để sửa"
              aria-label={`${fieldLabel(field)}: ${display || 'chưa có'}`} aria-describedby={errorId}
              className={cn(
                'block w-full truncate rounded-md px-1.5 py-1 text-left text-13 transition-colors hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                !display && 'text-muted-foreground',
                fieldState.error && 'text-destructive',
              )}
            >
              {display || '—'}
            </button>
          )}
        {fieldState.error && <p id={errorId} className="mt-1 text-xs text-destructive">{fieldState.error.message}</p>}
      </dd>
    </div>
  );
}

/** Label–value list; clicking a value edits it in place. */
export function MetadataInputs({ fields, control, editing, onEditingChange }: {
  fields: MetadataField[];
  control: Control<EditorForm>;
  /** Lifted so an error summary or server issue can open the right editor. */
  editing: string | null;
  onEditingChange: (name: string | null) => void;
}) {
  if (fields.length === 0) return <p className="text-13 text-muted-foreground">Knowledge base chưa có trường metadata.</p>;
  return (
    <dl className="space-y-1">
      {fields.map(field => (
        <MetadataRow
          key={field.id} field={field} control={control} editing={editing === field.name}
          onEdit={() => onEditingChange(field.name)}
          onDone={() => onEditingChange(null)}
        />
      ))}
    </dl>
  );
}
