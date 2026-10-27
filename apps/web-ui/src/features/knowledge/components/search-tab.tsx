'use client';

import { useState } from 'react';
import { RotateCw, Search, SearchCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useFields } from '../hooks/use-knowledge';
import { DEFAULT_SETTINGS, QUERY_MAX, buildSearchRequest, droppedConditions, type SearchSettings, type SearchState } from './build-search-request';
import { EmptyState } from './shared/empty-state';
import { errorMessage } from './shared/error-message';
import { relativeTime } from './shared/format';
import { SearchResults, SearchResultsSkeleton } from './search-results';
import { ConditionChips, SearchSettingsPopover } from './search-settings';
import { useSearchHistory } from './use-search-history';
import { useTimedSearch } from './use-timed-search';

export function SearchTab({ kb }: { kb: string }) {
  const { search, run: runSearch, elapsedMs } = useTimedSearch();
  const fieldsQuery = useFields(kb);
  const fields = fieldsQuery.data ?? [];
  // Without the field list every filter row would be dropped, so searching waits for it.
  const fieldsReady = !!fieldsQuery.data;
  const history = useSearchHistory(kb);
  const [query, setQuery] = useState('');
  const [settings, setSettings] = useState<SearchSettings>(DEFAULT_SETTINGS);
  // The query the shown results answer, for highlighting and retry; the textarea may have moved on.
  const [ran, setRan] = useState<SearchState | null>(null);

  const dropped = droppedConditions(settings, fields);

  const run = (state: SearchState) => {
    if (!state.query.trim() || !fieldsReady) return;
    setRan(state);
    history.add(state);
    runSearch({ kb, body: buildSearchRequest(state, fields) });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
      <div className="space-y-6">
        <form className="space-y-2" onSubmit={event => { event.preventDefault(); run({ query, settings }); }}>
          <div className="flex items-center justify-between">
            <Label htmlFor="search-query">Câu hỏi</Label>
            <SearchSettingsPopover kb={kb} settings={settings} fields={fields} onChange={setSettings} />
          </div>
          <Textarea
            id="search-query" rows={4} maxLength={QUERY_MAX} value={query} placeholder="Ví dụ: Học phí ngành CNTT HUTECH?"
            aria-describedby="search-query-count" className="resize-none font-sans"
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
            }}
          />
          <ConditionChips settings={settings} fields={fields} onChange={setSettings} />
          {fieldsQuery.error && (
            <p role="alert" className="text-xs text-destructive">
              Không tải được metadata nên chưa tìm được: {errorMessage(fieldsQuery.error)}{' '}
              <button type="button" className="underline" onClick={() => void fieldsQuery.refetch()}>Thử lại</button>
            </p>
          )}
          {fieldsReady && dropped > 0 && (
            <p className="text-xs text-muted-foreground">{dropped} điều kiện chưa đầy đủ nên không được áp dụng.</p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span id="search-query-count" className="text-xs text-muted-foreground">{query.length}/{QUERY_MAX} · Ctrl+Enter để tìm</span>
            <Button type="submit" disabled={!query.trim() || search.isPending || !fieldsReady}>
              <Search className="h-4 w-4" aria-hidden />Tìm
            </Button>
          </div>
        </form>
        <section aria-labelledby="search-history-heading" className="border-t pt-4">
          <h2 id="search-history-heading" className="mb-2 text-13 font-semibold text-muted-foreground">Gần đây</h2>
          {history.entries.length === 0 ? <p className="text-13 text-muted-foreground">Chưa có truy vấn nào.</p> : (
            <ul className="-mx-2 space-y-0.5">
              {history.entries.map(entry => (
                <li key={entry.at}>
                  <button type="button" disabled={search.isPending || !fieldsReady}
                    className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-13 hover:bg-primary-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    onClick={() => { setQuery(entry.query); setSettings(entry.settings); run({ query: entry.query, settings: entry.settings }); }}>
                    <span className="min-w-0 flex-1 truncate">{entry.query}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(entry.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="min-w-0" aria-busy={search.isPending}>
        {search.isPending ? (
          <SearchResultsSkeleton />
        ) : search.error ? (
          <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border px-4 py-3 text-sm">
            <p className="text-destructive">{errorMessage(search.error)}</p>
            <Button variant="outline" size="sm" onClick={() => ran && run(ran)} disabled={!ran}>
              <RotateCw className="h-4 w-4" aria-hidden />Thử lại
            </Button>
          </div>
        ) : search.data && ran ? (
          <SearchResults kb={kb} result={search.data} query={ran.query} settings={ran.settings} fields={fields} elapsedMs={elapsedMs} />
        ) : (
          <EmptyState icon={SearchCode} title="Nhập câu hỏi để xem agent sẽ đọc được gì"
            description="Kết quả hiện các đoạn theo thứ tự agent nhận được, kèm điểm và vị trí trong tài liệu." className="rounded-xl border border-dashed" />
        )}
      </div>
    </div>
  );
}
