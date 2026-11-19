'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api/errors';
import { streamDebugRun, type DebugRunEvent } from '../api/debug-run';
import type { WorkflowDebugRunRequest, WorkflowDebugRunResult } from '../types';

function formatRunError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'RES_NOT_FOUND' || error.code === 'RESOURCE_NOT_FOUND') {
      return 'Lần chạy thử đã hết hạn hoặc không còn tồn tại (thời gian lưu là 24 giờ).';
    }
    const issues = (error.details as { issues?: Array<{ path?: string; message?: string }> } | undefined)?.issues;
    if (Array.isArray(issues) && issues.length > 0) {
      const summary = issues
        .map(issue => (issue.path ? `${issue.path}: ${issue.message ?? ''}` : issue.message ?? ''))
        .filter(Boolean)
        .join('; ');
      if (summary) return `${error.message} (${summary})`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Không thể chạy thử workflow';
}

const STREAM_CUT = 'Lần chạy thử bị ngắt giữa chừng, chưa nhận được kết quả cuối. Hãy chạy lại.';

export function useDebugRun(beforeRun?: () => Promise<boolean>) {
  const [events, setEvents] = useState<DebugRunEvent[]>([]);
  const [result, setResult] = useState<WorkflowDebugRunResult | null>(null);
  const [delta, setDelta] = useState('');
  const [notSavedReason, setNotSavedReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async (request: WorkflowDebugRunRequest) => {
    setRunning(true);
    setError(null);
    setEvents([]);
    setResult(null);
    setDelta('');
    setNotSavedReason(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      if (beforeRun && !(await beforeRun())) throw new Error('Không thể lưu bản nháp trước khi chạy thử');
      let completed = false;
      for await (const event of streamDebugRun(request, controller.signal)) {
        // Deltas only feed the answer text: keeping them in `events` would copy the array once per token.
        if (event.event === 'delta') {
          setDelta(current => current + event.text);
          continue;
        }
        setEvents(current => [...current, event]);
        if (event.event === 'run_not_saved') setNotSavedReason(event.reason);
        if (event.event === 'completed') {
          completed = true;
          setResult(event.result);
        }
      }
      // A stream that closes without `completed` (runtime crash, proxy cut) is a failed run, not an empty one.
      if (!completed && !controller.signal.aborted) throw new Error(STREAM_CUT);
    } catch (runError) {
      const aborted = (runError instanceof DOMException || runError instanceof Error) && runError.name === 'AbortError';
      if (!aborted) setError(formatRunError(runError));
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
  }, [beforeRun]);

  const cancel = useCallback(() => abortRef.current?.abort(), []);

  return { events, result, delta, notSavedReason, error, running, run, cancel };
}
