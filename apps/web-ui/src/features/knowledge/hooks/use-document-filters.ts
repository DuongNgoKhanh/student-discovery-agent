'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { INDEX_STATUS_LABELS } from '../components/shared/index-status';
import type { DocumentFilters } from '../types';

export const DOCUMENT_STATES = {
  all: { label: 'Tất cả', filters: {} },
  // The API takes one index_status, so queued and in-progress revisions are separate states.
  pending: { label: INDEX_STATUS_LABELS.pending, filters: { status: 'active', index_status: 'pending' } },
  indexing: { label: INDEX_STATUS_LABELS.indexing, filters: { status: 'active', index_status: 'indexing' } },
  ready: { label: INDEX_STATUS_LABELS.ready, filters: { status: 'active', index_status: 'ready' } },
  error: { label: INDEX_STATUS_LABELS.error, filters: { status: 'active', index_status: 'error' } },
  archived: { label: 'Tắt truy xuất', filters: { status: 'archived' } },
} as const satisfies Record<string, { label: string; filters: DocumentFilters }>;
export type DocumentState = keyof typeof DOCUMENT_STATES;

const isState = (value: string | null): value is DocumentState => value !== null && value in DOCUMENT_STATES;

/** Search text and state filter live in the URL (`?q=&state=`) so the KB sidebar can deep-link to `state=error`. */
export function useDocumentFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const q = params.get('q') ?? '';
  const rawState = params.get('state');
  const state: DocumentState = isState(rawState) ? rawState : 'all';

  const update = useCallback((patch: { q?: string; state?: DocumentState }) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === 'all') next.delete(key); else next.set(key, value);
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const filters = useMemo<DocumentFilters>(() => ({ ...(q.trim() ? { q: q.trim() } : {}), ...DOCUMENT_STATES[state].filters }), [q, state]);
  return {
    q, state, filters, isFiltered: q.trim() !== '' || state !== 'all',
    setQ: (value: string) => update({ q: value }),
    setState: (value: DocumentState) => update({ state: value }),
    clear: () => update({ q: '', state: 'all' }),
  };
}
