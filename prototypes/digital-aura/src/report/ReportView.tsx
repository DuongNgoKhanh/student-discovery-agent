import { ArrowDown, FileDown, Info, Share2 } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { usePlayback, usePointerParallax } from '../sharecard/animation/use-playback';
import { ShareCard } from '../sharecard/components/ShareCard';
import { archetypes, brand } from '../sharecard/content';
import { CARD_WIDTH, layouts } from '../sharecard/layout';
import { FitBadge, MajorCard, type ScoreMode } from './MajorCard';
import { mockReports } from './mock-reports';
import { ShareSheet } from './ShareSheet';

interface ReportViewProps {
  archetypeId: string;
  mode: ScoreMode;
}

const formatDate = (iso: string) => iso.split('-').reverse().join('.');

/**
 * The student's report: the live card (the result reveal) next to the majors that fit, why they
 * fit, and the next step (share). Layout follows the container width, not the viewport, so the
 * same component renders the desktop and the mobile design.
 */
export function ReportView({ archetypeId, mode }: ReportViewProps) {
  const entry = archetypes[archetypeId]!;
  const { content, theme } = entry;
  const report = mockReports[archetypeId]!;
  const { palette } = theme;
  const [open, setOpen] = useState<boolean[]>([true, false, false]);
  const [sharing, setSharing] = useState(false);
  // The reveal waits for the artwork, so a slow network never plays the intro on an empty card.
  const playback = usePlayback({ initialAutoReplay: false, startPaused: true });
  const { pointer, handlers } = usePointerParallax(!playback.reduced);
  const cardColumn = useRef<HTMLDivElement>(null);
  const reportStart = useRef<HTMLDivElement>(null);
  const cardWidth = useColumnWidth(cardColumn);

  // A new result starts collapsed except the best match (its reveal starts once its art is ready).
  const { replay } = playback;
  useEffect(() => setOpen([true, false, false]), [archetypeId]);

  const vars = {
    '--r-accent': palette.accent,
    '--r-accent-soft': `${palette.accent}80`,
    '--r-on-accent': palette.veil,
    '--r-text': palette.text,
    '--r-body': `${palette.text}d9`,
    '--r-muted': palette.muted,
    '--r-chip': palette.chip,
    '--r-chip-border': palette.chipBorder,
    '--r-surface': 'rgba(255,255,255,0.035)',
    '--r-surface-strong': `${palette.accent}12`,
    '--r-glow': `${palette.glow ?? palette.accent}99`,
    background: `radial-gradient(ellipse 70% 45% at 12% 0%, ${palette.backdrop[0]}66, transparent 70%), radial-gradient(ellipse 60% 50% at 100% 100%, ${palette.backdrop[1]}cc, transparent 70%), ${palette.veil}`,
  } as CSSProperties;

  const share = () => setSharing(true);

  return (
    <div style={vars} className="@container/report min-h-full text-[var(--r-text)]">
      <div className="mx-auto max-w-[1180px] px-4 pt-5 pb-28 @4xl/report:px-8 @4xl/report:pt-8 @4xl/report:pb-12">
        {/* Product bar: the owner brand first. */}
        <div className="mb-5 hidden items-center justify-between gap-3 @4xl/report:flex">
          <img src={brand.logo.src} alt={brand.logo.alt} className="h-9 w-auto" />
          <span className="text-[11px] tracking-[0.26em] text-[var(--r-muted)] uppercase">
            {brand.label}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-6 @4xl/report:grid-cols-[minmax(300px,360px)_minmax(0,1fr)] @4xl/report:gap-8">
          {/* The card is the result reveal; on wide layouts it stays in view while reading. */}
          <div
            ref={cardColumn}
            {...handlers}
            className="flex touch-pan-y flex-col items-center gap-3 @4xl/report:sticky @4xl/report:top-6 @4xl/report:self-start"
          >
            <ShareCard
              data={content}
              theme={theme}
              ratio="9:16"
              time={playback.time}
              reduced={playback.reduced}
              pointer={pointer}
              displayWidth={cardWidth}
              onHeroReady={replay}
            />
            <button
              type="button"
              onClick={() => reportStart.current?.scrollIntoView({ behavior: 'smooth' })}
              className="flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-[var(--r-muted)] @4xl/report:hidden"
            >
              Xem báo cáo của bạn <ArrowDown size={16} aria-hidden />
            </button>
          </div>

          <section
            ref={reportStart}
            aria-labelledby="report-title"
            className="scroll-mt-4 rounded-3xl border border-white/10 bg-black/25 p-4 backdrop-blur-md @xl/report:p-6"
          >
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-[0.18em] text-[var(--r-muted)] uppercase">
                  Báo cáo khám phá bản thân
                </p>
                <h1
                  id="report-title"
                  className="font-display mt-1 text-[32px] leading-tight font-semibold text-balance @xl/report:text-[40px]"
                >
                  Ngành học phù hợp với bạn
                </h1>
                <p className="mt-1 text-sm text-[var(--r-body)]">
                  {content.name} · {content.archetype.title} · {formatDate(report.createdAt)}
                  {report.isDemo && (
                    <span className="ml-2 inline-block rounded-full border border-amber-200/40 bg-amber-200/10 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-amber-100">
                      Kết quả mẫu
                    </span>
                  )}
                </p>
              </div>
              <div className="hidden gap-2 @4xl/report:flex">
                <SaveButton />
                <ShareButton onClick={share} />
              </div>
            </header>

            <h2 className="mt-6 mb-3 text-xs font-semibold tracking-[0.16em] text-[var(--r-muted)] uppercase">
              Phù hợp nhất
            </h2>
            <div className="space-y-3">
              {report.majors.map((major, i) => (
                <MajorCard
                  key={`${archetypeId}-${i}`}
                  rank={i + 1}
                  major={major}
                  strengths={content.strengths}
                  mode={mode}
                  open={open[i] ?? false}
                  onToggle={() => setOpen((o) => o.map((v, j) => (j === i ? !v : v)))}
                />
              ))}
            </div>

            <h2 className="mt-7 mb-3 text-xs font-semibold tracking-[0.16em] text-[var(--r-muted)] uppercase">
              Các ngành khác có thể phù hợp
            </h2>
            <ol className="divide-y divide-white/8 rounded-2xl border border-white/10 bg-[var(--r-surface)]">
              {report.others.map((m, i) => (
                <li key={m.name} className="flex min-h-12 items-center gap-3 px-4 py-2.5">
                  <span className="w-5 text-sm text-[var(--r-muted)] tabular-nums">{i + 4}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px]">{m.name}</span>
                  <FitBadge score={m.score} mode={mode} size="sm" compactNarrow />
                </li>
              ))}
            </ol>

            <details className="group mt-6 rounded-2xl border border-white/10 bg-[var(--r-surface)] px-4 py-3 text-sm text-[var(--r-body)]">
              <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-[var(--r-text)]">
                <Info size={16} aria-hidden className="text-[var(--r-accent)]" />
                Kết quả này được tính thế nào?
              </summary>
              <p className="mt-2 leading-relaxed">
                Mức phù hợp so khớp điểm mạnh và xu hướng trong câu trả lời của bạn với đặc điểm của
                từng ngành. Đây là gợi ý để bạn tìm hiểu thêm, không phải kết luận. Hãy trao đổi với
                thầy cô, gia đình và người làm trong ngành trước khi quyết định.
              </p>
              <p className="mt-2 text-xs text-[var(--r-muted)]">
                Bản mockup: ngành, mức phù hợp và tổ hợp xét tuyển là dữ liệu mẫu.
              </p>
            </details>
          </section>
        </div>
      </div>

      {/* Mobile: the next step is always in thumb reach. */}
      <div className="sticky bottom-0 z-10 border-t border-white/10 bg-[var(--r-on-accent)]/90 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur-md @4xl/report:hidden">
        <div className="mx-auto flex max-w-[560px] gap-2">
          <SaveButton compact />
          <ShareButton onClick={share} grow />
        </div>
      </div>

      <ShareSheet open={sharing} onClose={() => setSharing(false)} data={content} theme={theme} />
    </div>
  );
}

function ShareButton({ onClick, grow }: { onClick(): void; grow?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[var(--r-accent)] px-5 text-sm font-semibold text-[var(--r-on-accent)] transition-[filter] duration-200 hover:brightness-110 ${grow ? 'flex-1' : ''}`}
    >
      <Share2 size={17} aria-hidden />
      Chia sẻ thẻ
    </button>
  );
}

function SaveButton({ compact }: { compact?: boolean }) {
  return (
    <button
      type="button"
      disabled
      title="Chưa có trong bản mockup"
      aria-label="Lưu báo cáo PDF (chưa có trong bản mockup)"
      className="inline-flex h-11 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-white/15 px-4 text-sm font-semibold text-[var(--r-muted)] opacity-70"
    >
      <FileDown size={17} aria-hidden />
      {!compact && 'Lưu báo cáo'}
      {compact && <span className="sr-only">Lưu báo cáo</span>}
    </button>
  );
}

/** Card width: fills the column on narrow layouts (capped), fixed-ish on wide ones. */
function useColumnWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const byHeight = ((window.innerHeight - 140) * CARD_WIDTH) / layouts['9:16'].height;
      setWidth(Math.floor(Math.max(260, Math.min(el.clientWidth, 400, Math.max(300, byHeight)))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
