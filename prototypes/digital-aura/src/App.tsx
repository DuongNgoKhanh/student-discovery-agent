import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ReportPage } from './report/ReportPage';
import { Studio } from './studio/Studio';

type View = 'report' | 'studio';
const viewFromHash = (): View => (window.location.hash === '#studio' ? 'studio' : 'report');

/** Mockup shell: the report (main flow, default) and the ShareCard studio. */
export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  useEffect(() => {
    const sync = () => setView(viewFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  return (
    <div className="min-h-dvh text-violet-50">
      <header className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-3 px-4 pt-5 sm:px-8">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl border border-violet-300/25 bg-violet-400/10">
            <Sparkles size={18} className="text-violet-200" aria-hidden />
          </span>
          <div>
            <p className="font-display text-2xl leading-none font-semibold tracking-tight">
              Digital Aura
            </p>
            <p className="mt-1 text-xs tracking-[0.2em] text-violet-200/60 uppercase">Mockup</p>
          </div>
        </div>
        <nav aria-label="Màn hình" className="flex gap-1 rounded-xl bg-white/5 p-1">
          {(
            [
              ['report', 'Báo cáo'],
              ['studio', 'Studio thẻ'],
            ] as const
          ).map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={view === id ? 'page' : undefined}
              className="flex min-h-10 items-center rounded-lg px-4 text-sm font-semibold text-violet-200/70 transition-colors aria-[current=page]:bg-violet-400/25 aria-[current=page]:text-violet-50"
            >
              {label}
            </a>
          ))}
        </nav>
      </header>
      {view === 'report' ? <ReportPage /> : <Studio />}
    </div>
  );
}
