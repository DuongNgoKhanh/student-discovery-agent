'use client';

import { useCallback, useState } from 'react';
import { useSearchKnowledge } from '../hooks/use-knowledge';
import type { SearchResult } from '../types';

type SearchVars = Parameters<ReturnType<typeof useSearchKnowledge>['mutate']>[0];

/**
 * The search mutation plus its round-trip time measured in the browser (the runtime reports no timing).
 * Errors stay on `search.error`; `mutate` never rejects, so nothing goes unhandled.
 */
export function useTimedSearch() {
  const search = useSearchKnowledge();
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const { mutate } = search;
  const run = useCallback((vars: SearchVars, onDone?: (result: SearchResult, elapsedMs: number) => void) => {
    setElapsedMs(null);
    const started = performance.now();
    mutate(vars, {
      onSuccess: result => {
        const elapsed = Math.max(0, Math.round(performance.now() - started));
        setElapsedMs(elapsed);
        onDone?.(result, elapsed);
      },
    });
  }, [mutate]);
  return { search, run, elapsedMs };
}
