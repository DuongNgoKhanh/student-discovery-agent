'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SearchState } from './build-search-request';

export const HISTORY_LIMIT = 10;
export interface HistoryEntry extends SearchState { at: string }

const storageKey = (kb: string) => `knowledge.search-history.${kb}`;

// Storage can be missing or throw (private mode, quota, blocked site data); history is a convenience only.
function read(kb: string): HistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(kb)) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item): item is HistoryEntry => typeof item?.query === 'string' && typeof item?.at === 'string' && !!item?.settings)
      : [];
  } catch {
    return [];
  }
}

function write(kb: string, entries: HistoryEntry[]) {
  try { window.localStorage.setItem(storageKey(kb), JSON.stringify(entries)); } catch { /* keep the in-memory list */ }
}

const sameSearch = (a: SearchState, b: SearchState) => a.query === b.query && JSON.stringify(a.settings) === JSON.stringify(b.settings);

/** Last searches of one KB, newest first; re-running a search moves it to the top instead of duplicating it. */
export function useSearchHistory(kb: string) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  useEffect(() => setEntries(read(kb)), [kb]);
  const add = useCallback((search: SearchState) => {
    setEntries(current => {
      const next = [{ ...search, at: new Date().toISOString() }, ...current.filter(entry => !sameSearch(entry, search))]
        .slice(0, HISTORY_LIMIT);
      write(kb, next);
      return next;
    });
  }, [kb]);
  return { entries, add };
}
