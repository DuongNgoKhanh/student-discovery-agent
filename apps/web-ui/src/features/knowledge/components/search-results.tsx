'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronsDownUp, ChevronsUpDown, FileSearch, Info, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import type { MetadataField, SearchResult } from '../types';
import type { SearchSettings } from './build-search-request';
import { DocumentDetailSheet, type RetrievedChunk } from './document-detail-sheet';
import { highlightSegments } from './highlight';
import { MarkdownPreview } from './markdown-preview';
import { CopyButton } from './shared/copy-button';
import { EmptyState } from './shared/empty-state';
import { SearchSummary, isNarrowed } from './search-summary';

type SearchRecord = SearchResult['records'][number];

const CLAMP_CHARS = 280;
const CLAMP_LINES = 4;
const isLong = (content: string) => content.length > CLAMP_CHARS || content.split('\n').length > CLAMP_LINES;

const SCORE_HINT = 'Điểm 0–1 kết hợp độ tương đồng ngữ nghĩa (cosine) và tỉ lệ từ của câu hỏi có trong đoạn, theo trọng số đang dùng. Không phải độ chính xác hay %.';
const SCORE_HINT_KEYWORD = 'Điểm 0–1 chỉ gồm tỉ lệ từ của câu hỏi có trong đoạn (đang chỉ tìm theo từ khoá). Không phải độ chính xác hay %.';

const present = (value: unknown) => value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);
const show = (value: unknown) => (Array.isArray(value) ? value.map(String).join(', ') : String(value));
const asInt = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** One muted line: field values by label in field order; internals (document_id, chunk, revision, source_url) stay out. */
export function metadataLine(metadata: SearchRecord['metadata'], fields: MetadataField[]): string {
  return [...fields].sort((a, b) => a.ordinal - b.ordinal)
    .filter(field => present(metadata[field.name]))
    .map(field => `${field.label || field.name}: ${show(metadata[field.name])}`)
    .join(' · ');
}

/** `Chunk #n · rN`, skipping whichever part the record lacks. */
export function positionLabel(chunk: number | undefined, revision: number | undefined): string {
  return [chunk !== undefined && `Chunk #${chunk}`, revision !== undefined && `r${revision}`].filter(Boolean).join(' · ');
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

function ScoreBadge({ score, degraded }: { score: number; degraded: boolean }) {
  const width = Math.min(1, Math.max(0, score)) * 100;
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Điểm kết hợp</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label="Giải thích điểm kết hợp"
            className="rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Info className="h-3.5 w-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{degraded ? SCORE_HINT_KEYWORD : SCORE_HINT}</TooltipContent>
      </Tooltip>
      <span className="font-mono text-13 font-medium">{score.toFixed(3)}</span>
      <span aria-hidden className="h-1 w-10 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </span>
    </div>
  );
}

export type ChunkView = 'markdown' | 'raw';

function ResultCard({ rank, record, query, fields, degraded, view, expanded, onToggle, onOpen }: {
  rank: number; record: SearchRecord; query: string; fields: MetadataField[]; degraded: boolean;
  view: ChunkView; expanded: boolean; onToggle: () => void;
  onOpen: (docId: string, chunk: RetrievedChunk) => void;
}) {
  const long = isLong(record.content);
  const documentId = typeof record.metadata.document_id === 'string' && record.metadata.document_id ? record.metadata.document_id : null;
  const chunk = asInt(record.metadata.chunk);
  const revision = asInt(record.metadata.revision);
  const position = positionLabel(chunk, revision);
  const meta = metadataLine(record.metadata, fields);
  const clamped = long && !expanded;
  const open = () => documentId && onOpen(documentId, { content: record.content, chunk, revision, score: record.score, query });
  return (
    <li className="rounded-lg border bg-card" aria-label={`#${rank} ${record.title}`}>
      <div className="space-y-1 px-3 pt-3">
        <div className="flex items-center gap-2">
          <span className="w-7 shrink-0 font-mono text-13 font-semibold text-primary">#{rank}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={record.title}>{record.title}</span>
          <ScoreBadge score={record.score} degraded={degraded} />
        </div>
        {(position || meta) && (
          <p className="flex min-w-0 gap-1.5 pl-9 text-xs text-muted-foreground">
            {position && <span className="shrink-0 font-mono">{position}</span>}
            {position && meta && <span aria-hidden>·</span>}
            {meta && <span className="truncate" title={meta}>{meta}</span>}
          </p>
        )}
      </div>
      <div id={`chunk-${rank}`} className={cn('relative mx-3 mt-2 pl-9', clamped && 'max-h-24 overflow-hidden')}>
        {view === 'markdown'
          ? <MarkdownPreview source={record.content} highlight={query} compact />
          : <p className="whitespace-pre-wrap break-words font-mono text-13 leading-6"><Highlighted text={record.content} query={query} /></p>}
        {clamped && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card" />}
      </div>
      <div className="flex items-center gap-1 px-3 pb-2 pt-1 pl-12">
        {long && (
          <button type="button" aria-expanded={expanded} aria-controls={`chunk-${rank}`} onClick={onToggle}
            className="inline-flex items-center gap-1 rounded-sm py-1 text-13 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden />
            {expanded ? 'Thu gọn' : 'Xem thêm'}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <CopyButton value={record.content} label="Copy đoạn" copiedLabel="Đã copy đoạn" iconOnly variant="ghost" className="h-8 w-8 text-muted-foreground" />
          {documentId ? (
            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={open}>
              <FileSearch className="h-4 w-4" aria-hidden />Xem nguồn
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A disabled button gets no pointer events, so the wrapper carries the tooltip. */}
                <span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Button type="button" variant="ghost" size="sm" className="h-8" disabled>
                    <FileSearch className="h-4 w-4" aria-hidden />Xem nguồn
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Đoạn này không kèm mã tài liệu nguồn.</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </li>
  );
}

const TOGGLE = 'rounded px-2 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** How chunks render and whether long ones are open; sits between the summary and the list. */
function ResultsToolbar({ view, onView, canExpand, allExpanded, onExpandAll }: {
  view: ChunkView; onView: (view: ChunkView) => void; canExpand: boolean; allExpanded: boolean; onExpandAll: (open: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div role="group" aria-label="Cách hiển thị đoạn" className="inline-flex rounded-md border bg-card p-0.5">
        {([['markdown', 'Markdown'], ['raw', 'Văn bản gốc']] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={view === value} onClick={() => onView(value)}
            className={cn(TOGGLE, view === value ? 'bg-primary-subtle font-medium text-primary' : 'text-muted-foreground hover:text-foreground')}>
            {label}
          </button>
        ))}
      </div>
      {canExpand && (
        <button type="button" onClick={() => onExpandAll(!allExpanded)}
          className="inline-flex items-center gap-1 rounded-sm text-13 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {allExpanded ? <ChevronsDownUp className="h-4 w-4" aria-hidden /> : <ChevronsUpDown className="h-4 w-4" aria-hidden />}
          {allExpanded ? 'Thu gọn tất cả' : 'Mở rộng tất cả'}
        </button>
      )}
    </div>
  );
}

export function SearchResultsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      <p role="status" className="sr-only">Đang tìm…</p>
      <Skeleton className="h-9 w-full rounded-lg" />
      <ul aria-hidden className="space-y-2">
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className="space-y-2.5 rounded-lg border p-3">
            <div className="flex items-center gap-3"><Skeleton className="h-4 w-6" /><Skeleton className="h-4 flex-1" /><Skeleton className="h-4 w-24" /></div>
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface SearchResultsProps {
  kb: string;
  result: SearchResult;
  query: string;
  fields: MetadataField[];
  /** The settings the shown results ran with. */
  settings: SearchSettings;
  elapsedMs: number | null;
}

export function SearchResults({ kb, result, query, fields, settings, elapsedMs }: SearchResultsProps) {
  const [source, setSource] = useState<{ docId: string; chunk: RetrievedChunk } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [view, setView] = useState<ChunkView>('markdown');
  // Ranks of the long chunks shown in full; results are remounted per search, so this starts empty each time.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const longRanks = result.records.flatMap((record, index) => (isLong(record.content) ? [index + 1] : []));
  const allExpanded = longRanks.length > 0 && longRanks.every(rank => expanded.has(rank));
  const toggle = (rank: number) => setExpanded(current => {
    const next = new Set(current);
    if (!next.delete(rank)) next.add(rank);
    return next;
  });
  return (
    <div className="space-y-3">
      <SearchSummary count={result.records.length} elapsedMs={elapsedMs} degraded={result.degraded} settings={settings} fields={fields} />
      {result.degraded && (
        <p className="flex items-center gap-2 text-13 text-warning-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />Đang chỉ tìm theo từ khoá (embedding câu hỏi lỗi).
        </p>
      )}
      {result.records.length === 0
        ? (
          <EmptyState icon={SearchX} title="Không có đoạn nào vượt ngưỡng." className="rounded-xl border"
            description={isNarrowed(settings, fields)
              ? 'Thử hạ ngưỡng điểm, bỏ bớt điều kiện lọc hoặc tăng Top K trong Cài đặt truy xuất.'
              : 'Thử diễn đạt câu hỏi khác hoặc kiểm tra tài liệu đã index xong chưa.'} />
        )
        : (
          <>
            <ResultsToolbar view={view} onView={setView} canExpand={longRanks.length > 0} allExpanded={allExpanded}
              onExpandAll={open => setExpanded(open ? new Set(longRanks) : new Set())} />
            <ol aria-label="Kết quả truy xuất" className="space-y-2">
              {result.records.map((record, index) => (
                <ResultCard key={index} rank={index + 1} record={record} query={query} fields={fields} degraded={result.degraded}
                  view={view} expanded={expanded.has(index + 1)} onToggle={() => toggle(index + 1)}
                  onOpen={(docId, chunk) => { setSource({ docId, chunk }); setSheetOpen(true); }} />
              ))}
            </ol>
          </>
        )}
      <DocumentDetailSheet kb={kb} docId={source?.docId ?? null} open={sheetOpen} onOpenChange={setSheetOpen} chunk={source?.chunk} />
    </div>
  );
}
