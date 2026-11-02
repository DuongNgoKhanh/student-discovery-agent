'use client';

import Link from 'next/link';
import { Plus, Settings2, X } from 'lucide-react';
import { IconButton } from '@/components/shared/icon-button';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import type { MetadataField } from '../types';
import {
  DEFAULT_SETTINGS, MAX_CONDITIONS, OPERATORS, isValueless, toCondition, type FilterCondition, type SearchSettings,
} from './build-search-request';
import { kbHref } from './kb-routes';

const newId = () => Math.random().toString(36).slice(2, 10);
/** A cleared or unparsable number input means "unset", never NaN. */
const numberOrNull = (input: HTMLInputElement) => (Number.isNaN(input.valueAsNumber) ? null : input.valueAsNumber);

export interface SearchSettingsPopoverProps {
  kb: string;
  settings: SearchSettings;
  fields: MetadataField[];
  onChange: (settings: SearchSettings) => void;
}

/** Retrieval params and metadata filters behind one ⚙ button (plan §4.6); Radix returns focus to the trigger on close. */
export function SearchSettingsPopover({ kb, settings, fields, onChange }: SearchSettingsPopoverProps) {
  const filterable = fields.filter(field => field.filterable);
  const set = (patch: Partial<SearchSettings>) => onChange({ ...settings, ...patch });
  const changed = JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton className="relative h-8 w-8" label="Cài đặt truy xuất">
          <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          {changed && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[80vh] w-[min(420px,calc(100vw-32px))] space-y-4 overflow-y-auto text-sm">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Cài đặt truy xuất</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(DEFAULT_SETTINGS)} disabled={!changed}>Đặt lại</Button>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3">
          <Label htmlFor="search-top-k">Số kết quả</Label>
          <Input id="search-top-k" type="number" min={1} max={20} placeholder="Mặc định" value={settings.topK ?? ''}
            onChange={event => set({ topK: numberOrNull(event.target) })} />
          <Label htmlFor="search-max-chunks">
            Tối đa đoạn/tài liệu <span className="font-normal text-muted-foreground">(tuỳ chọn)</span>
          </Label>
          <Input id="search-max-chunks" type="number" min={1} max={10} placeholder="Mặc định" value={settings.maxChunksPerDoc ?? ''}
            onChange={event => set({ maxChunksPerDoc: numberOrNull(event.target) })} />
        </div>
        <OptionalSlider
          id="search-threshold" label="Ngưỡng điểm" value={settings.scoreThreshold} fallback={0.5}
          onChange={scoreThreshold => set({ scoreThreshold })}
        />
        <OptionalSlider
          id="search-semantic" label="Ngữ nghĩa ↔ Từ khoá" value={settings.semanticWeight} fallback={0.7} ends={['Từ khoá', 'Ngữ nghĩa']}
          onChange={semanticWeight => set({ semanticWeight })}
        />
        <section aria-labelledby="search-filter-heading" className="space-y-3 border-t pt-4">
          <p id="search-filter-heading" className="font-semibold">Lọc metadata</p>
          {filterable.length === 0 ? (
            <p className="text-13 text-muted-foreground">
              Chưa có field nào cho phép lọc. Bật &ldquo;Lọc&rdquo; cho field trong{' '}
              <Link href={kbHref(kb, 'documents')} className="text-primary underline-offset-2 hover:underline">Metadata ở trang Tài liệu</Link>.
            </p>
          ) : (
            <ConditionEditor settings={settings} fields={filterable} onChange={set} />
          )}
        </section>
      </PopoverContent>
    </Popover>
  );
}

function OptionalSlider({ id, label, value, fallback, ends, onChange }: {
  id: string; label: string; value: number | null; fallback: number; ends?: [string, string]; onChange: (value: number | null) => void;
}) {
  const on = value !== null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${id}-switch`}>{label}</Label>
        <div className="flex items-center gap-2">
          {on && <span className="font-mono text-13">{value.toFixed(2)}</span>}
          <Switch id={`${id}-switch`} checked={on} onCheckedChange={checked => onChange(checked ? fallback : null)} />
        </div>
      </div>
      {on && (
        <>
          <Slider min={0} max={1} step={0.05} value={[value]} thumbLabels={[label]} onValueChange={([next]) => onChange(next ?? fallback)} />
          {ends && <div className="flex justify-between text-xs text-muted-foreground"><span>{ends[0]}</span><span>{ends[1]}</span></div>}
        </>
      )}
    </div>
  );
}

function ConditionEditor({ settings, fields, onChange }: {
  settings: SearchSettings; fields: MetadataField[]; onChange: (patch: Partial<SearchSettings>) => void;
}) {
  const rows = settings.conditions;
  const update = (id: string, patch: Partial<FilterCondition>) =>
    onChange({ conditions: rows.map(row => (row.id === id ? { ...row, ...patch } : row)) });
  const add = () => onChange({ conditions: [...rows, { id: newId(), name: fields[0]!.name, operator: OPERATORS[fields[0]!.type][0]!, value: '' }] });
  return (
    <div className="space-y-2">
      {rows.length > 1 && (
        <Select value={settings.logicalOperator} onValueChange={value => onChange({ logicalOperator: value as SearchSettings['logicalOperator'] })}>
          <SelectTrigger aria-label="Kết hợp điều kiện" className="h-8 w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="and">Tất cả điều kiện</SelectItem>
            <SelectItem value="or">Bất kỳ điều kiện</SelectItem>
          </SelectContent>
        </Select>
      )}
      {rows.map((row, index) => {
        const field = fields.find(item => item.name === row.name);
        const operators = field ? OPERATORS[field.type] : [];
        const n = index + 1;
        return (
          <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_32px] items-center gap-1.5">
            <Select value={row.name}
              onValueChange={name => {
                const next = fields.find(item => item.name === name);
                if (next) update(row.id, { name, operator: OPERATORS[next.type][0]!, value: '' });
              }}>
              <SelectTrigger aria-label={`Field điều kiện ${n}`} className="h-8 px-2 text-13"><SelectValue placeholder="Field" /></SelectTrigger>
              <SelectContent>
                {fields.map(item => <SelectItem key={item.id} value={item.name}>{item.label || item.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={row.operator} onValueChange={operator => update(row.id, { operator })}>
              <SelectTrigger aria-label={`Phép so sánh điều kiện ${n}`} className="h-8 px-2 text-13"><SelectValue /></SelectTrigger>
              <SelectContent>
                {operators.map(operator => <SelectItem key={operator} value={operator}>{operator}</SelectItem>)}
              </SelectContent>
            </Select>
            {isValueless(row.operator) ? <span aria-hidden /> : (
              <Input aria-label={`Giá trị điều kiện ${n}`} className="h-8 px-2 text-13" value={row.value}
                type={field?.type === 'number' ? 'number' : field?.type === 'time' ? 'datetime-local' : 'text'}
                onChange={event => update(row.id, { value: event.target.value })} />
            )}
            <IconButton className="h-8 w-8" label={`Xoá điều kiện ${n}`} tooltip="Xoá điều kiện"
              onClick={() => onChange({ conditions: rows.filter(item => item.id !== row.id) })}>
              <X className="h-4 w-4" aria-hidden />
            </IconButton>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={add} disabled={rows.length >= MAX_CONDITIONS}>
        <Plus className="h-4 w-4" aria-hidden />Thêm điều kiện
      </Button>
    </div>
  );
}

export interface ConditionChipsProps {
  settings: SearchSettings;
  fields: MetadataField[];
  onChange: (settings: SearchSettings) => void;
  className?: string;
}

/** Only rows that would be sent show up as chips, so what you see is what the request filters on. */
export function ConditionChips({ settings, fields, onChange, className }: ConditionChipsProps) {
  const active = settings.conditions.flatMap(row => {
    const condition = toCondition(row, fields);
    const field = fields.find(item => item.name === row.name);
    return condition && field ? [{ row, label: field.label || field.name, condition }] : [];
  });
  if (active.length === 0) return null;
  return (
    <ul aria-label="Điều kiện lọc đang áp" className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {active.length > 1 && <li className="text-xs text-muted-foreground">{settings.logicalOperator === 'or' ? 'Bất kỳ:' : 'Tất cả:'}</li>}
      {active.map(({ row, label, condition }) => {
        const text = `${label} ${condition.comparison_operator}${condition.value === undefined ? '' : ` ${String(condition.value)}`}`;
        return (
          <li key={row.id} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-sidebar py-0.5 pl-2 pr-0.5 text-xs">
            <span className="truncate">{text}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label={`Bỏ lọc ${text}`}
                  className="rounded p-0.5 text-muted-foreground hover:bg-primary-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onChange({ ...settings, conditions: settings.conditions.filter(item => item.id !== row.id) })}>
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent>Bỏ lọc</TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
