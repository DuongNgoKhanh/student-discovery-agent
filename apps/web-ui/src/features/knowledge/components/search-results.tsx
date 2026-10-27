'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { MetadataField, SearchResult } from '../types';
import { highlightSegments } from './highlight';
import { kbHref } from './knowledge-base-shell';

type SearchRecord = SearchResult['records'][number];

const CLAMP_CHARS = 280;
const CLAMP_LINES = 4;

const present = (value: unknown) => value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);
const show = (value: unknown) => (Array.isArray(value) ? value.map(String).join(', ') : String(value));

/** One muted line: field values by label in field order, then the revision; internals (document_id, chunk…) stay hidden. */
export function metadataLine(metadata: SearchRecord['metadata'], fields: MetadataField[]): string {
  const parts = [...fields].sort((a, b) => a.ordinal - b.ordinal)
    .filter(field => present(metadata[field.name]))
    .map(field => `${field.label || field.name}: ${show(metadata[field.name])}`);
  if (present(metadata.revision)) parts.push(`r${String(metadata.revision)}`);
  return parts.join(' · ');
}

export function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightSegments(text, query).map((segment, index) => (segment.match
        ? <mark key={index} className="rounded-sm bg-warning-subtle px-px text-foreground">{segment.text}</mark>
        : <span key={index}>{segment.text}</span>))}
    </>
  );
}

function ResultCard({ kb, record, query, fields }: { kb: string; record: SearchRecord; query: string; fields: MetadataField[] }) {
  const [expanded, setExpanded] = useState(false);
  const long = record.content.length > CLAMP_CHARS || record.content.split('\n').length > CLAMP_LINES;
  const documentId = typeof record.metadata.document_id === 'string' ? record.metadata.document_id : null;
  const meta = metadataLine(record.metadata, fields);
  const score = Math.min(1, Math.max(0, record.score));
  return (
    <li className="space-y-2 rounded-xl border p-4">
      <div className="flex items-center gap-3">
        <span className="flex shrink-0 items-center gap-2" title="Điểm">
          <span className="font-mono text-13 font-medium">{record.score.toFixed(3)}</span>
          <span aria-hidden className="h-1 w-12 overflow-hidden rounded-full bg-muted">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${score * 100}%` }} />
          </span>
        </span>
        {documentId ? (
          <Link href={kbHref(kb, `documents/${encodeURIComponent(documentId)}`)}
            className="min-w-0 truncate text-sm font-medium hover:text-primary hover:underline">{record.title}</Link>
        ) : <span className="min-w-0 truncate text-sm font-medium">{record.title}</span>}
      </div>
      <p className={expanded ? 'whitespace-pre-wrap text-sm' : 'line-clamp-4 whitespace-pre-wrap text-sm'}>
        <Highlighted text={record.content} query={query} />
      </p>
      {long && (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}
          className="text-13 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {expanded ? 'Thu gọn' : 'Xem thêm'}
        </button>
      )}
      {meta && <p className="truncate text-xs text-muted-foreground" title={meta}>{meta}</p>}
    </li>
  );
}

export interface SearchResultsProps { kb: string; result: SearchResult; query: string; fields: MetadataField[] }

export function SearchResults({ kb, result, query, fields }: SearchResultsProps) {
  return (
    <div className="space-y-3">
      <p role="status" className="text-sm font-semibold">{result.records.length} đoạn</p>
      {result.degraded && (
        <p className="flex items-center gap-2 text-13 text-warning-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />Đang chỉ tìm theo từ khoá (embedding câu hỏi lỗi).
        </p>
      )}
      {result.records.length === 0
        ? <p className="rounded-xl border px-4 py-8 text-center text-13 text-muted-foreground">Không có đoạn nào vượt ngưỡng.</p>
        : (
          <ol aria-label="Kết quả truy xuất" className="space-y-3">
            {result.records.map((record, index) => <ResultCard key={index} kb={kb} record={record} query={query} fields={fields} />)}
          </ol>
        )}
    </div>
  );
}
