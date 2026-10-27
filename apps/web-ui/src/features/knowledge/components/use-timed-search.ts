'use client';

import { useCallback, useState } from 'react';
import { useSearchKnowledge } from '../hooks/use-knowledge';

type SearchVars = Parameters<ReturnType<typeof useSearchKnowledge>['mutate']>[0];

/**
 * The search mutation plus its round-trip time measured in the browser (the runtime reports no timing).
 * Errors stay on `search.error`; `mutate` never rejects, so nothing goes unhandled.
 */
export function useTimedSearch() {
  const search = useSearchKnowledge();
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const { mutate } = search;
  const run = useCallback((vars: SearchVars) => {
    setElapsedMs(null);
    const started = performance.now();
    mutate(vars, { onSuccess: () => setElapsedMs(Math.max(0, Math.round(performance.now() - started))) });
  }, [mutate]);
  return { search, run, elapsedMs };
}
