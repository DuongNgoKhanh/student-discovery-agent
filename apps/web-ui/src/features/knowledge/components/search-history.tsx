'use client';

import { useState } from 'react';
import { Search, X } from 'lucide-react';
import { IconButton } from '@/components/shared/icon-button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import type { MetadataField } from '../types';
import { relativeTime } from './shared/format';
import { settingsSummary } from './search-summary';
import type { HistoryEntry } from './use-search-history';

/** Past this many entries a filter box helps more than scrolling. */
const FILTER_FROM = 6;

export interface SearchHistoryProps {
  entries: HistoryEntry[];
  fields: MetadataField[];
  /** Key (`at`) of the entry whose results are on screen. */
  activeAt: string | null;
  disabled: boolean;
  onRun: (entry: HistoryEntry) => void;
  onRemove: (at: string) => void;
  onClear: () => void;
}

const outcome = (entry: HistoryEntry) =>
  entry.count === undefined ? null : `${entry.count} kết quả${entry.elapsedMs === undefined ? '' : ` · ${entry.elapsedMs} ms`}`;

export function SearchHistory({ entries, fields, activeAt, disabled, onRun, onRemove, onClear }: SearchHistoryProps) {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLocaleLowerCase('vi');
  const visible = needle ? entries.filter(entry => entry.query.toLocaleLowerCase('vi').includes(needle)) : entries;
  return (
    <section aria-labelledby="search-history-heading" className="space-y-2 border-t pt-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="search-history-heading" className="text-13 font-semibold text-muted-foreground">Gần đây</h2>
        {entries.length > 0 && (
          <button type="button" onClick={onClear}
            className="rounded-sm text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Xoá lịch sử
          </button>
        )}
      </div>
      {entries.length >= FILTER_FROM && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Lọc lịch sử truy vấn" placeholder="Lọc lịch sử…" className="h-8 pl-8 text-13"
            value={filter} onChange={event => setFilter(event.target.value)} />
        </div>
      )}
      {entries.length === 0 ? <p className="text-13 text-muted-foreground">Chưa có truy vấn nào.</p>
        : visible.length === 0 ? <p className="text-13 text-muted-foreground">Không có truy vấn nào khớp “{filter.trim()}”.</p> : (
          <ul className="-mx-2 max-h-[420px] space-y-0.5 overflow-y-auto">
            {visible.map(entry => {
              const details = [outcome(entry), settingsSummary(entry.settings, fields), relativeTime(entry.at)].filter(Boolean).join(' · ');
              const active = entry.at === activeAt;
              return (
                <li key={entry.at} className={cn('group flex items-start gap-1 rounded-md pr-1 hover:bg-primary-subtle', active && 'bg-primary-subtle')}>
                  <button type="button" disabled={disabled} aria-current={active || undefined} onClick={() => onRun(entry)}
                    className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                    <span className={cn('block truncate text-13', active && 'font-medium text-primary')}>{entry.query}</span>
                    <span className="block truncate text-xs text-muted-foreground">{details}</span>
                  </button>
                  <IconButton label={`Xoá khỏi lịch sử: ${entry.query}`} tooltip="Xoá khỏi lịch sử" onClick={() => onRemove(entry.at)}
                    className="mt-1 h-7 w-7 shrink-0 text-muted-foreground md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </IconButton>
                </li>
              );
            })}
          </ul>
        )}
    </section>
  );
}
