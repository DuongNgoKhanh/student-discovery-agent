'use client';

import { Braces, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useKnowledgeBases } from '@/features/knowledge';
import { cn } from '@/lib/utils/cn';
import { canonical } from '../model/config';
import {
  CONDITION_OPERATORS,
  conditionToRows,
  OPERATOR_LABELS,
  rowsToCondition,
  VARIABLE_PATH,
  type ConditionRow,
  type ConditionRows,
} from '../model/workflow/condition';
import type { VariableGroup } from '../model/workflow/variables';
import { TOOL_CATALOG } from '../model/tools';

export type SchemaProperty = Record<string, unknown>;

export interface FieldProps {
  name: string;
  property: SchemaProperty;
  value: unknown;
  required?: boolean;
  disabled: boolean;
  variables: VariableGroup[];
  onChange: (value: unknown) => void;
  /** Reports text the field cannot store yet (invalid JSON), keyed by `name`; null once it parses. */
  onValidity: (name: string, error: string | null) => void;
}

const FIELD_LABELS: Record<string, string> = {
  condition: 'Điều kiện',
  input: 'Đầu vào',
  labels: 'Nhãn ý định',
  instructions: 'Chỉ dẫn',
  model: 'Model',
  history_messages: 'Số tin nhắn lịch sử',
  prompt: 'Prompt',
  output: 'Định dạng output',
  json_schema: 'JSON schema của output',
  max_output_tokens: 'Token output tối đa',
  context_refs: 'Tài liệu ngữ cảnh',
  tools: 'Tool được dùng',
  max_tool_steps: 'Số bước tool tối đa',
  knowledge_base_id: 'Knowledge base',
  query: 'Truy vấn',
  fixed_filter: 'Bộ lọc cố định',
  filter_from_vars: 'Lọc theo biến',
  top_k: 'Số đoạn trả về',
  tool: 'Tool',
  arguments: 'Tham số',
  fields: 'Trường hồ sơ',
  target_step: 'Bước đích',
  assignments: 'Phép gán',
  variable: 'Biến',
  operation: 'Phép toán',
  value: 'Giá trị',
  text: 'Nội dung trả lời',
  blocks: 'Block',
  id: 'Mã nhánh',
  description: 'Mô tả',
  examples: 'Câu ví dụ',
  type: 'Loại',
  ref: 'Tham chiếu',
  items: 'Lựa chọn',
};

const FIELD_HINTS: Record<string, string> = {
  input: 'Văn bản model phân loại; dùng {{biến}} để chèn giá trị.',
  model: 'Để trống để dùng model của agent.',
  history_messages: 'Số tin nhắn gần nhất gửi kèm (0–6).',
  context_refs: 'Mỗi dòng một id node truy xuất tri thức.',
  examples: 'Mỗi dòng một câu, tối đa 5.',
  fields: 'Mỗi dòng một trường hồ sơ.',
  id: 'Chữ thường, số, gạch dưới; đây là tên nhánh trên sơ đồ.',
  variable: 'Dạng conv.tên_biến.',
  value: 'Số, true/false, "chuỗi" hoặc JSON; chữ thường được lưu là chuỗi.',
};

const ITEM_NOUNS: Record<string, string> = { labels: 'Nhãn', assignments: 'Phép gán', blocks: 'Block' };

const OPTION_LABELS: Record<string, string> = {
  text: 'Văn bản',
  json: 'JSON',
  set: 'Gán',
  append: 'Thêm vào cuối',
  clear: 'Xoá',
  add: 'Cộng thêm',
  knowledge_card: 'Thẻ tri thức',
  suggestions: 'Gợi ý trả lời',
  upstream: 'Nội dung từ node trước',
  and: 'Tất cả (AND)',
  or: 'Một trong (OR)',
};

const TEMPLATE_FIELDS = new Set(['prompt', 'instructions', 'text', 'input', 'query']);
const MULTILINE_FIELDS = new Set(['prompt', 'instructions', 'text']);
const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50';

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function fieldLabel(name: string, property: SchemaProperty): string {
  const key = name.split('.').at(-1)!;
  return typeof property.title === 'string' ? property.title : FIELD_LABELS[key] ?? key;
}

/** `anyOf: [X, null]` reads as an optional X; other unions stay as they are (and use the JSON editor). */
function resolve(property: SchemaProperty): SchemaProperty {
  if (!Array.isArray(property.anyOf)) return property;
  const options = property.anyOf.map(asObject).filter((option): option is SchemaProperty => Boolean(option));
  const concrete = options.filter((option) => option.type !== 'null');
  if (concrete.length !== 1 || concrete.length === options.length) return property;
  const rest = { ...property };
  delete rest.anyOf;
  return { ...concrete[0], ...rest };
}

type FieldKind = 'condition' | 'tool' | 'tools' | 'kb' | 'enum' | 'boolean' | 'number' | 'text' | 'strings' | 'objects' | 'any' | 'json';

function fieldKind(property: SchemaProperty): FieldKind {
  const widget = property['x-widget'];
  if (widget === 'condition_builder') return 'condition';
  if (widget === 'tool_picker') return property.type === 'array' ? 'tools' : 'tool';
  if (widget === 'kb_picker') return 'kb';
  if (Array.isArray(property.enum)) return 'enum';
  if (property.type === 'boolean') return 'boolean';
  if (property.type === 'integer' || property.type === 'number') return 'number';
  if (property.type === 'string') return 'text';
  if (property.type === 'array') {
    const items = asObject(property.items);
    if (items?.type === 'string' && !items.enum) return 'strings';
    if (asObject(items?.properties)) return 'objects';
  }
  if (property.type === undefined && !property.anyOf && !property.properties) return 'any';
  return 'json';
}

/** Keeps a field's own draft while its edits echo back, and resyncs only when the value changed elsewhere. */
function useDraft<T>(value: unknown, toDraft: (value: unknown) => T): [T, (draft: T, stored: unknown) => void] {
  const [draft, setDraft] = useState(() => toDraft(value));
  const last = useRef(canonical(value));
  const toDraftRef = useRef(toDraft);
  toDraftRef.current = toDraft;
  useEffect(() => {
    const next = canonical(value);
    if (next !== last.current) {
      last.current = next;
      setDraft(toDraftRef.current(value));
    }
  }, [value]);
  return [draft, (next, stored) => { last.current = canonical(stored); setDraft(next); }];
}

function FieldShell({ id, label, required, hint, action, children }: {
  id: string; label: string; required?: boolean; hint?: ReactNode; action?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-5 items-center justify-between gap-2">
        <Label htmlFor={id} className="text-13 font-medium">
          {label}
          {required ? <span aria-hidden className="ml-0.5 text-destructive">*</span> : null}
        </Label>
        {action}
      </div>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function fieldId(name: string): string {
  return `node-config-${name.replace(/\./g, '-')}`;
}

function VariableInsert({ label, variables, disabled, onInsert }: {
  label: string; variables: VariableGroup[]; disabled: boolean; onInsert: (token: string) => void;
}) {
  if (!variables.length) return null;
  return (
    <label className="relative inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-primary hover:bg-primary-subtle">
      <Braces aria-hidden className="size-3.5" />
      Chèn biến
      <select
        aria-label={`Chèn biến vào ${label}`}
        className="absolute inset-0 cursor-pointer opacity-0"
        value=""
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value) onInsert(`{{${event.target.value}}}`);
        }}
      >
        <option value="">Chọn biến</option>
        {variables.map((group) => (
          <optgroup key={group.title} label={group.title}>
            {group.paths.map((path) => <option key={path} value={path}>{path}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

function TextField({ name, property, value, required, disabled, variables, onChange }: FieldProps) {
  const label = fieldLabel(name, property);
  const id = fieldId(name);
  const key = name.split('.').at(-1)!;
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const text = typeof value === 'string' ? value : '';
  const placeholder = typeof property.default === 'string' && property.default ? property.default : undefined;
  const emit = (next: string) => onChange(next === '' && !required ? undefined : next);
  const insert = (token: string) => {
    const element = ref.current;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    emit(text.slice(0, start) + token + text.slice(end));
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const shared = {
    id,
    ref,
    'aria-label': label,
    value: text,
    placeholder,
    disabled,
    onChange: (event: { target: { value: string } }) => emit(event.target.value),
  };
  return (
    <FieldShell
      id={id}
      label={label}
      required={required}
      hint={FIELD_HINTS[key]}
      action={TEMPLATE_FIELDS.has(key) ? <VariableInsert label={label} variables={variables} disabled={disabled} onInsert={insert} /> : null}
    >
      {MULTILINE_FIELDS.has(key) ? <Textarea {...shared} rows={key === 'prompt' ? 6 : 4} className="text-sm" /> : <Input {...shared} />}
    </FieldShell>
  );
}

function NumberField({ name, property, value, required, disabled, onChange }: FieldProps) {
  const label = fieldLabel(name, property);
  const id = fieldId(name);
  const shown = value !== undefined && value !== null ? value : property.default;
  return (
    <FieldShell id={id} label={label} required={required} hint={FIELD_HINTS[name.split('.').at(-1)!]}>
      <Input
        id={id}
        aria-label={label}
        type="number"
        min={typeof property.minimum === 'number' ? property.minimum : undefined}
        max={typeof property.maximum === 'number' ? property.maximum : undefined}
        step={property.type === 'integer' ? 1 : 'any'}
        value={shown === undefined || shown === null ? '' : String(shown)}
        disabled={disabled}
        className="w-32"
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
      />
    </FieldShell>
  );
}

function EnumField({ name, property, value, required, disabled, onChange }: FieldProps) {
  const label = fieldLabel(name, property);
  const id = fieldId(name);
  const options = property.enum as unknown[];
  const current = value !== undefined ? value : property.default;
  return (
    <FieldShell id={id} label={label} required={required}>
      <select
        id={id}
        aria-label={label}
        className={selectClass}
        value={current === undefined || current === null ? '' : String(current)}
        disabled={disabled}
        // Map back to the schema's own value, so a numeric enum is not stored as a string.
        onChange={(event) => onChange(options.find((option) => String(option) === event.target.value))}
      >
        <option value="">Chọn…</option>
        {options.map((option) => (
          <option key={String(option)} value={String(option)}>
            {OPTION_LABELS[String(option)] ?? String(option)}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

function BooleanField({ name, property, value, disabled, onChange }: FieldProps) {
  const label = fieldLabel(name, property);
  const id = fieldId(name);
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-13 font-medium">{label}</Label>
      <Switch
        id={id}
        aria-label={label}
        checked={value !== undefined ? value === true : property.default === true}
        disabled={disabled}
        onCheckedChange={(checked) => onChange(checked)}
      />
    </div>
  );
}

function StringListField({ name, property, value, required, disabled, onChange }: FieldProps) {
  const label = fieldLabel(name, property);
  const id = fieldId(name);
  const toText = (stored: unknown) => (Array.isArray(stored) ? stored.map(String).join('\n') : '');
  const [text, setText] = useDraft(value, toText);
  return (
    <FieldShell id={id} label={label} required={required} hint={FIELD_HINTS[name.split('.').at(-1)!] ?? 'Mỗi dòng một giá trị.'}>
      <Textarea
        id={id}
        aria-label={label}
        rows={3}
        className="text-sm"
        value={text}
        disabled={disabled}
        onChange={(event) => {
          const lines = event.target.value.split('\n').map((line) => line.trim()).filter(Boolean);
          const stored = lines.length || required ? lines : undefined;
          setText(event.target.value, stored);
          onChange(stored);
        }}
      />
    </FieldShell>
  );
}

function anyText(stored: unknown): string {
  if (stored === undefined || stored === null) return '';
  if (typeof stored === 'string') {
    try {
      // A string that would read back as a number, boolean or JSON is shown quoted.
      JSON.parse(stored);
      return JSON.stringify(stored);
    } catch {
      return stored;
    }
  }
  return JSON.stringify(stored);
}

function parseAny(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function AnyValueField({ name, property, value, required, disabled, onChange }: FieldProps) {
  const label = fieldLabel(name, property);
  const id = fieldId(name);
  const [text, setText] = useDraft(value, anyText);
  return (
    <FieldShell id={id} label={label} required={required} hint={FIELD_HINTS[name.split('.').at(-1)!]}>
      <Input
        id={id}
        aria-label={label}
        className="font-mono text-xs"
        value={text}
        disabled={disabled}
        onChange={(event) => {
          const stored = parseAny(event.target.value);
          setText(event.target.value, stored);
          onChange(stored);
        }}
      />
    </FieldShell>
  );
}

export function JsonField({ name, property, value, required, disabled, onChange, onValidity, hint }: FieldProps & { hint?: string }) {
  const label = fieldLabel(name, property);
  const id = fieldId(name);
  const toText = (stored: unknown) => JSON.stringify(stored !== undefined ? stored : property.default ?? null, null, 2);
  const [text, setText] = useState(() => toText(value));
  const [error, setError] = useState<string | null>(null);
  const lastCanonical = useRef(canonical(value));

  // Resync only on outside edits (canvas, JSON tab): echoing our own edit back would reformat the text and move the caret.
  useEffect(() => {
    const nextCanonical = canonical(value);
    if (!error && nextCanonical !== lastCanonical.current) {
      lastCanonical.current = nextCanonical;
      setText(JSON.stringify(value !== undefined ? value : property.default ?? null, null, 2));
    }
  }, [value, property.default, error]);

  return (
    <FieldShell id={id} label={label} required={required} hint={error ? undefined : hint ?? 'Nhập dạng JSON.'}>
      <Textarea
        id={id}
        aria-label={label}
        rows={4}
        className="font-mono text-xs"
        value={text}
        disabled={disabled}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          try {
            // An emptied field unsets the key instead of being a syntax error.
            const parsed = nextText.trim() === '' ? undefined : JSON.parse(nextText);
            lastCanonical.current = canonical(parsed);
            setError(null);
            onValidity(name, null);
            onChange(parsed);
          } catch (err) {
            setError((err as Error).message);
            onValidity(name, `${label}: JSON chưa hợp lệ`);
          }
        }}
      />
      {error ? <p role="alert" className="text-xs text-destructive">JSON chưa hợp lệ: {error}</p> : null}
    </FieldShell>
  );
}

function defaultItem(schema: SchemaProperty | undefined): Record<string, unknown> {
  const properties = asObject(schema?.properties) ?? {};
  const required = Array.isArray(schema?.required) ? (schema.required as string[]) : [];
  const item: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(properties)) {
    const property = resolve(asObject(raw) ?? {});
    if (property.default !== undefined && property.default !== null) item[key] = structuredClone(property.default);
    else if (required.includes(key) && property.type === 'string') item[key] = '';
  }
  return item;
}

function ObjectListField(props: FieldProps) {
  const { name, property, value, required, disabled, onChange } = props;
  const label = fieldLabel(name, property);
  const key = name.split('.').at(-1)!;
  const noun = ITEM_NOUNS[key] ?? 'Mục';
  const itemSchema = asObject(property.items);
  const itemProperties = Object.entries(asObject(itemSchema?.properties) ?? {});
  const itemRequired = Array.isArray(itemSchema?.required) ? (itemSchema.required as string[]) : [];
  const items = Array.isArray(value) ? value : [];
  const max = typeof property.maxItems === 'number' ? property.maxItems : Infinity;
  const min = typeof property.minItems === 'number' ? property.minItems : 0;

  const setItem = (index: number, field: string, fieldValue: unknown) => {
    const next = items.map((item, at) => {
      if (at !== index) return item;
      const updated = { ...(asObject(item) ?? {}) };
      if (fieldValue === undefined) delete updated[field];
      else updated[field] = fieldValue;
      return updated;
    });
    onChange(next);
  };

  return (
    <div role="group" aria-label={label} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-13 font-medium">
          {label}
          {required ? <span aria-hidden className="ml-0.5 text-destructive">*</span> : null}
        </span>
        <span className="text-xs text-muted-foreground">
          {items.length}
          {Number.isFinite(max) ? `/${max}` : ''}
          {min ? ` · tối thiểu ${min}` : ''}
        </span>
      </div>
      {items.map((item, index) => (
        <div key={index} className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">{noun} {index + 1}</span>
            <button
              type="button"
              aria-label={`Xoá ${noun.toLowerCase()} ${index + 1}`}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              disabled={disabled}
              onClick={() => onChange(items.filter((_, at) => at !== index))}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
          {itemProperties.map(([field, raw]) => (
            <NodeField
              key={field}
              {...props}
              name={`${name}.${index}.${field}`}
              property={asObject(raw) ?? {}}
              value={asObject(item)?.[field]}
              required={itemRequired.includes(field)}
              onChange={(fieldValue) => setItem(index, field, fieldValue)}
            />
          ))}
        </div>
      ))}
      <button
        type="button"
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-13 text-muted-foreground hover:border-primary/50 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled || items.length >= max}
        onClick={() => onChange([...items, defaultItem(itemSchema)])}
      >
        <Plus className="size-4" /> Thêm {noun.toLowerCase()}
      </button>
    </div>
  );
}

function ConditionField(props: FieldProps) {
  const { name, property, value, required, disabled, variables, onChange } = props;
  const label = fieldLabel(name, property);
  const [draft, setDraft] = useDraft(value, conditionToRows);
  const [asJson, setAsJson] = useState(draft === null);
  const listId = `${fieldId(name)}-variables`;

  if (asJson || draft === null) {
    return (
      <div className="space-y-1.5">
        <JsonField {...props} hint={draft === null ? 'Điều kiện lồng nhau chỉ sửa được dạng JSON.' : 'Điều kiện dạng JSONLogic.'} />
        {draft !== null ? (
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAsJson(false)}>
            Dùng trình tạo điều kiện
          </button>
        ) : null}
      </div>
    );
  }

  const update = (next: ConditionRows) => {
    const stored = rowsToCondition(next);
    setDraft(next, stored);
    onChange(stored);
  };
  const setRow = (index: number, patch: Partial<ConditionRow>) =>
    update({ ...draft, rows: draft.rows.map((row, at) => (at === index ? { ...row, ...patch } : row)) });

  return (
    <div role="group" aria-label={label} className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-13 font-medium">
          {label}
          {required ? <span aria-hidden className="ml-0.5 text-destructive">*</span> : null}
        </span>
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAsJson(true)}>
          Sửa dạng JSON
        </button>
      </div>
      {draft.rows.length > 1 ? (
        <div className="flex items-center gap-2 text-13">
          <span className="text-muted-foreground">Đúng khi</span>
          <select
            aria-label="Cách kết hợp điều kiện"
            className="h-8 rounded-md border border-input bg-background px-2 text-13"
            value={draft.logic}
            disabled={disabled}
            onChange={(event) => update({ ...draft, logic: event.target.value as 'and' | 'or' })}
          >
            <option value="and">{OPTION_LABELS.and}</option>
            <option value="or">{OPTION_LABELS.or}</option>
          </select>
        </div>
      ) : null}
      <datalist id={listId}>
        {variables.flatMap((group) => group.paths).map((path) => <option key={path} value={path} />)}
      </datalist>
      {draft.rows.map((row, index) => {
        const badVariable = row.variable !== '' && !VARIABLE_PATH.test(row.variable);
        return (
          <div key={index} className="space-y-1.5 rounded-lg border bg-muted/30 p-2.5">
            <div className="flex items-center gap-1.5">
              <Input
                aria-label={`Biến điều kiện ${index + 1}`}
                list={listId}
                placeholder="sys.query"
                className={cn('h-8 flex-1 font-mono text-xs', badVariable && 'border-destructive')}
                value={row.variable}
                disabled={disabled}
                onChange={(event) => setRow(index, { variable: event.target.value.trim() })}
              />
              <button
                type="button"
                aria-label={`Xoá điều kiện ${index + 1}`}
                className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                disabled={disabled}
                onClick={() => update({ ...draft, rows: draft.rows.filter((_, at) => at !== index) })}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <select
                aria-label={`Phép so sánh ${index + 1}`}
                className="h-8 w-36 shrink-0 rounded-md border border-input bg-background px-2 text-13"
                value={row.operator}
                disabled={disabled}
                onChange={(event) => setRow(index, { operator: event.target.value as ConditionRow['operator'] })}
              >
                {CONDITION_OPERATORS.map((operator) => (
                  <option key={operator} value={operator}>{OPERATOR_LABELS[operator]}</option>
                ))}
              </select>
              {row.operator !== 'missing' ? (
                <Input
                  aria-label={`Giá trị so sánh ${index + 1}`}
                  placeholder={row.operator === 'in' ? 'a, b, c' : 'giá trị hoặc {{biến}}'}
                  className="h-8 flex-1 font-mono text-xs"
                  value={row.value}
                  disabled={disabled}
                  onChange={(event) => setRow(index, { value: event.target.value })}
                />
              ) : null}
            </div>
            {badVariable ? <p className="text-xs text-destructive">Biến cần dạng namespace.tên, ví dụ conv.buoc.</p> : null}
          </div>
        );
      })}
      <button
        type="button"
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-13 text-muted-foreground hover:border-primary/50 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
        disabled={disabled}
        onClick={() => update({ ...draft, rows: [...draft.rows, { variable: '', operator: '==', value: '' }] })}
      >
        <Plus className="size-4" /> Thêm điều kiện
      </button>
      {draft.rows.length === 0 ? <p className="text-xs text-muted-foreground">Chưa có điều kiện: nhánh này chưa chạy được.</p> : null}
    </div>
  );
}

function ToolField({ name, property, value, required, disabled, onChange }: FieldProps) {
  const label = fieldLabel(name, property);
  const id = fieldId(name);
  const current = typeof value === 'string' ? value : '';
  const known = TOOL_CATALOG.some((tool) => tool.name === current);
  return (
    <FieldShell id={id} label={label} required={required} hint="Tool cần được bật ở mục Tools & Knowledge.">
      <select id={id} aria-label={label} className={selectClass} value={current} disabled={disabled}
        onChange={(event) => onChange(event.target.value || undefined)}>
        <option value="">Chọn tool…</option>
        {TOOL_CATALOG.map((tool) => <option key={tool.name} value={tool.name}>{tool.label} ({tool.name})</option>)}
        {current && !known ? <option value={current}>{current}</option> : null}
      </select>
    </FieldShell>
  );
}

function ToolsField({ name, property, value, disabled, onChange }: FieldProps) {
  const label = fieldLabel(name, property);
  const chosen = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const unknown = chosen.filter((item) => !TOOL_CATALOG.some((tool) => tool.name === item));
  const toggle = (tool: string, on: boolean) => onChange(on ? [...chosen, tool] : chosen.filter((item) => item !== tool));
  return (
    <div role="group" aria-label={label} className="space-y-1.5">
      <span className="text-13 font-medium">{label}</span>
      <div className="divide-y rounded-lg border">
        {[...TOOL_CATALOG.map((tool) => ({ name: tool.name, label: tool.label })), ...unknown.map((item) => ({ name: item, label: item }))].map((tool) => (
          <label key={tool.name} className="flex items-center justify-between gap-3 px-3 py-2 text-13">
            <span>
              {tool.label} <span className="font-mono text-xs text-muted-foreground">{tool.name}</span>
            </span>
            <Switch aria-label={`Dùng ${tool.label}`} checked={chosen.includes(tool.name)} disabled={disabled}
              onCheckedChange={(on) => toggle(tool.name, on)} />
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Chỉ dùng được tool đã bật ở mục Tools & Knowledge.</p>
    </div>
  );
}

function KnowledgeBaseField({ name, property, value, required, disabled, onChange }: FieldProps) {
  const label = fieldLabel(name, property);
  const id = fieldId(name);
  const bases = useKnowledgeBases();
  const current = typeof value === 'string' ? value : '';
  if (!bases.data) {
    return (
      <FieldShell id={id} label={label} required={required}
        hint={bases.isError ? 'Không tải được danh sách knowledge base; nhập id.' : 'Đang tải danh sách knowledge base…'}>
        <Input id={id} aria-label={label} value={current} disabled={disabled} onChange={(event) => onChange(event.target.value || undefined)} />
      </FieldShell>
    );
  }
  const known = bases.data.some((kb) => kb.id === current);
  return (
    <FieldShell id={id} label={label} required={required}>
      <select id={id} aria-label={label} className={selectClass} value={current} disabled={disabled}
        onChange={(event) => onChange(event.target.value || undefined)}>
        <option value="">Chọn knowledge base…</option>
        {bases.data.map((kb) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
        {current && !known ? <option value={current}>{current} (không tìm thấy)</option> : null}
      </select>
    </FieldShell>
  );
}

/** One config field, with an editor chosen from its schema; unknown shapes fall back to JSON. */
export function NodeField(props: FieldProps) {
  const property = resolve(props.property);
  const resolved = { ...props, property };
  switch (fieldKind(property)) {
    case 'condition': return <ConditionField {...resolved} />;
    case 'tool': return <ToolField {...resolved} />;
    case 'tools': return <ToolsField {...resolved} />;
    case 'kb': return <KnowledgeBaseField {...resolved} />;
    case 'enum': return <EnumField {...resolved} />;
    case 'boolean': return <BooleanField {...resolved} />;
    case 'number': return <NumberField {...resolved} />;
    case 'text': return <TextField {...resolved} />;
    case 'strings': return <StringListField {...resolved} />;
    case 'objects': return <ObjectListField {...resolved} />;
    case 'any': return <AnyValueField {...resolved} />;
    default: return <JsonField {...resolved} />;
  }
}
