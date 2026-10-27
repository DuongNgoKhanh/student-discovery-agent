'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils/cn';
import type { ImportPreviewRow, ImportReport } from '../types';
import { kbHref } from './knowledge-base-shell';
import { StatusDot, type StatusTone } from './shared/status-dot';

type Action = ImportPreviewRow['action'];

const ACTIONS: { action: Action; label: string; tone: StatusTone }[] = [
  { action: 'create', label: 'tạo mới', tone: 'success' },
  { action: 'update', label: 'cập nhật', tone: 'neutral' },
  { action: 'unchanged', label: 'không đổi', tone: 'neutral' },
  { action: 'invalid', label: 'lỗi', tone: 'danger' },
];
const ACTION_TEXT: Record<Action, string> = { create: 'Tạo mới', update: 'Cập nhật', unchanged: 'Không đổi', invalid: 'Lỗi' };

export interface ImportPreviewTableProps {
  rows: ImportPreviewRow[];
}

/** Summary chips double as a filter for the preview table. */
export function ImportPreviewTable({ rows }: ImportPreviewTableProps) {
  const [filter, setFilter] = useState<Action | null>(null);
  const shown = filter ? rows.filter(row => row.action === filter) : rows;

  return (
    <div className="space-y-3">
      <div role="status" aria-live="polite" aria-label="Tóm tắt xem trước" className="flex flex-wrap items-center gap-1 text-13">
        {ACTIONS.map(({ action, label, tone }, index) => (
          <span key={action} className="inline-flex items-center gap-1">
            {index > 0 && <span aria-hidden className="text-muted-foreground">·</span>}
            <button
              type="button"
              aria-pressed={filter === action}
              onClick={() => setFilter(filter === action ? null : action)}
              className={cn(
                'rounded-md px-2 py-1 transition-colors hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filter === action && 'bg-primary-subtle text-primary',
              )}
            >
              <StatusDot tone={tone}>{`${rows.filter(row => row.action === action).length} ${label}`}</StatusDot>
            </button>
          </span>
        ))}
        {filter && <Button type="button" variant="link" size="sm" className="h-auto px-2" onClick={() => setFilter(null)}>Bỏ lọc</Button>}
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12">#</TableHead>
              <TableHead>Tài liệu</TableHead>
              <TableHead>Hành động</TableHead>
              <TableHead>Lỗi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map(row => (
              <TableRow key={row.row}>
                <TableCell className="text-muted-foreground">{row.row}</TableCell>
                <TableCell className="max-w-xs">
                  <div className="truncate">{row.payload?.title || row.source}</div>
                  {row.document_id && <div className="truncate font-mono text-xs text-muted-foreground">{row.document_id}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <StatusDot tone={ACTIONS.find(item => item.action === row.action)!.tone}>{ACTION_TEXT[row.action]}</StatusDot>
                </TableCell>
                <TableCell>
                  {row.errors.length > 0 && (
                    <ul className="space-y-0.5 text-destructive">
                      {row.errors.map(error => <li key={error}>{error}</li>)}
                    </ul>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const OUTCOMES: { key: keyof Pick<ImportReport, 'created' | 'updated' | 'unchanged' | 'conflict' | 'failed'>; label: string }[] = [
  { key: 'created', label: 'Tạo' },
  { key: 'updated', label: 'Sửa' },
  { key: 'unchanged', label: 'Không đổi' },
  { key: 'conflict', label: 'Xung đột' },
  { key: 'failed', label: 'Lỗi' },
];

export interface ImportResultProps {
  kb: string;
  report: ImportReport;
}

export function ImportResult({ kb, report }: ImportResultProps) {
  const problems = report.rows.filter(row => row.outcome === 'conflict' || row.outcome === 'failed' || row.error);
  return (
    <div className="space-y-4" role="status" aria-label="Kết quả nhập">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {OUTCOMES.map(({ key, label }) => (
          <div key={key} className="rounded-xl border px-4 py-3">
            <dt className="text-13 text-muted-foreground">{label}</dt>
            <dd className={cn('text-lg font-semibold', (key === 'conflict' || key === 'failed') && report[key] > 0 && 'text-destructive')}>{report[key]}</dd>
          </div>
        ))}
      </dl>
      {problems.length > 0 && (
        <div className="rounded-xl border">
          <p className="border-b px-4 py-2 text-13 font-medium">Dòng chưa ghi được</p>
          <ul className="divide-y text-13">
            {problems.map(row => (
              <li key={row.row} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2">
                <span className="text-muted-foreground">{`#${row.row}`}</span>
                <Link href={kbHref(kb, `documents/${encodeURIComponent(row.document_id)}`)} className="font-mono text-xs text-primary hover:underline">
                  {row.document_id}
                </Link>
                <StatusDot tone="danger">{row.outcome === 'conflict' ? 'Xung đột' : 'Lỗi'}</StatusDot>
                {row.error && <span className="text-muted-foreground">{row.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
