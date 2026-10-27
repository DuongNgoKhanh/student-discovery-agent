import type { DocumentDetail, DocumentSummary } from '../../types';
import type { StatusTone } from './status-dot';

export type DocumentStatusKind = 'archived' | 'error' | 'indexing' | 'ready';
export interface DocumentStatus { kind: DocumentStatusKind; label: string; tone: StatusTone; hint?: string }

/** One status column for the table and editor (plan §4.2): archived wins, then the latest revision's index state. */
export function documentStatus(doc: DocumentSummary | DocumentDetail): DocumentStatus {
  const detail = 'latest' in doc;
  const indexStatus = detail ? doc.latest.index_status : doc.index_status;
  const active = detail ? doc.active?.revision ?? null : doc.active_revision;
  if (doc.status === 'archived') return { kind: 'archived', label: 'Đã tắt', tone: 'neutral' };
  if (indexStatus === 'error') {
    return { kind: 'error', label: 'Lỗi index', tone: 'danger', hint: (detail ? doc.latest.error : null) ?? undefined };
  }
  if (indexStatus === 'pending' || indexStatus === 'indexing') {
    return { kind: 'indexing', label: 'Đang index', tone: 'warning', hint: active ? `Agent vẫn dùng r${active}` : undefined };
  }
  return { kind: 'ready', label: 'Sẵn sàng', tone: 'success' };
}
