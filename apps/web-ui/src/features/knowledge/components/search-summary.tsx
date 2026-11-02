import type { MetadataField } from '../types';
import { DEFAULT_SETTINGS, toCondition, type SearchSettings } from './build-search-request';

const appliedConditions = (settings: SearchSettings, fields: MetadataField[]) =>
  settings.conditions.filter(row => toCondition(row, fields) !== null).length;

/** Muted recap of the settings a search ran with; empty when they are all defaults. */
export function settingsSummary(settings: SearchSettings, fields: MetadataField[]): string {
  const conditions = appliedConditions(settings, fields);
  const extra: string[] = [];
  if (settings.scoreThreshold !== null) extra.push(`ngưỡng ${settings.scoreThreshold.toFixed(2)}`);
  if (settings.semanticWeight !== null) extra.push(`trọng số ngữ nghĩa ${settings.semanticWeight.toFixed(2)}`);
  if (settings.maxChunksPerDoc !== null) extra.push(`tối đa ${settings.maxChunksPerDoc} đoạn/tài liệu`);
  if (conditions > 0) extra.push(`${conditions} điều kiện lọc`);
  const topK = settings.topK ?? DEFAULT_SETTINGS.topK;
  if (extra.length === 0 && topK === DEFAULT_SETTINGS.topK) return '';
  return [`Top ${topK}`, ...extra].join(' · ');
}

/** Whether a search narrowed results beyond Top K, so an empty result deserves a "loosen it" hint. */
export const isNarrowed = (settings: SearchSettings, fields: MetadataField[]) =>
  settings.scoreThreshold !== null || settings.maxChunksPerDoc !== null || appliedConditions(settings, fields) > 0;

export interface SearchSummaryProps {
  count: number;
  elapsedMs: number | null;
  degraded: boolean;
  settings: SearchSettings;
  fields: MetadataField[];
}

export function SearchSummary({ count, elapsedMs, degraded, settings, fields }: SearchSummaryProps) {
  const recap = settingsSummary(settings, fields);
  const parts = [
    `${count} kết quả`,
    elapsedMs !== null ? `${elapsedMs} ms (đo tại trình duyệt)` : null,
    `Chế độ: ${degraded ? 'Chỉ từ khoá' : 'Kết hợp ngữ nghĩa + từ khoá'}`,
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border bg-sidebar px-3 py-2">
      <p role="status" className="text-13 font-medium">{parts.join(' · ')}</p>
      {recap && <p className="text-xs text-muted-foreground">{recap}</p>}
    </div>
  );
}
