'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SearchState } from './build-search-request';

export const HISTORY_LIMIT = 20;
export interface HistoryEntry extends SearchState {
  at: string;
  /** Filled in once the search answers; missing for searches that failed or are still running. */
  count?: number;
  elapsedMs?: number;
}

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
  const update = useCallback((change: (current: HistoryEntry[]) => HistoryEntry[]) => {
    setEntries(current => {
      const next = change(current);
      write(kb, next);
      return next;
    });
  }, [kb]);
  /** Records a search and returns its key, to attach the outcome with `settle`. */
  const add = useCallback((search: SearchState) => {
    const at = new Date().toISOString();
    update(current => [{ query: search.query, settings: search.settings, at }, ...current.filter(entry => !sameSearch(entry, search))]
      .slice(0, HISTORY_LIMIT));
    return at;
  }, [update]);
  const settle = useCallback((at: string, outcome: { count: number; elapsedMs: number }) => {
    update(current => current.map(entry => (entry.at === at ? { ...entry, ...outcome } : entry)));
  }, [update]);
  const remove = useCallback((at: string) => update(current => current.filter(entry => entry.at !== at)), [update]);
  const clear = useCallback(() => update(() => []), [update]);
  return { entries, add, settle, remove, clear };
}
