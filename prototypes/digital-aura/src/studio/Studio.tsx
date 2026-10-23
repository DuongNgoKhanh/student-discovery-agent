import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlayback, usePointerParallax } from '../sharecard/animation/use-playback';
import { AnimationController } from '../sharecard/components/AnimationController';
import { ExportController } from '../sharecard/components/ExportController';
import { ShareCard, type ShareCardHandle } from '../sharecard/components/ShareCard';
import { archetypes, defaultArchetype } from '../sharecard/content';
import { CARD_WIDTH, layouts } from '../sharecard/layout';
import type { ArchetypeId, ArtworkAsset, CardRatio, ShareCardData } from '../sharecard/types';
import { ArtworkInput } from './ArtworkInput';
import { ContentEditor } from './ContentEditor';

// Review aids: ?t=1800 freezes the preview at 1.8 s, ?ratio=4:5, ?reduced=1, ?archetype=decoder, ?loop=1 (auto-replay).
const params = new URLSearchParams(window.location.search);
const frozenAt = params.has('t') ? Number(params.get('t')) : null;
const initialRatio: CardRatio = params.get('ratio') === '4:5' ? '4:5' : '9:16';
const requested = params.get('archetype');
const initialArchetype: ArchetypeId =
  requested && requested in archetypes ? requested : defaultArchetype;
const archetypeIds = Object.keys(archetypes) as ArchetypeId[];

export function Studio() {
  const [archetypeId, setArchetypeId] = useState<ArchetypeId>(initialArchetype);
  const entry = archetypes[archetypeId]!;
  // Edits and uploaded artwork are kept per archetype while switching between them.
  const [edits, setEdits] = useState<Record<string, ShareCardData>>({});
  const [customArts, setCustomArts] = useState<Record<string, ArtworkAsset>>({});
  const data = edits[archetypeId] ?? entry.content;
  const setData = (next: ShareCardData) => setEdits((all) => ({ ...all, [archetypeId]: next }));
  const customArt = customArts[archetypeId] ?? null;
  const setCustomArt = (asset: ArtworkAsset | null) =>
    setCustomArts(({ [archetypeId]: _, ...rest }) =>
      asset ? { ...rest, [archetypeId]: asset } : rest,
    );
  const [ratio, setRatio] = useState<CardRatio>(initialRatio);
  const [showSafe, setShowSafe] = useState(params.has('safe'));
  const safe = layouts[ratio].safe;
  const [artError, setArtError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const theme = useMemo(
    () => (customArt ? { ...entry.theme, artwork: customArt } : entry.theme),
    [entry.theme, customArt],
  );

  const playback = usePlayback({
    initialTime: frozenAt ?? 0,
    // Wait for the hero artwork before the reveal starts (see onHeroReady below).
    startPaused: true,
    suspended: exporting,
    initialAutoReplay: params.has('loop') ? params.get('loop') === '1' : undefined,
  });
  const { setReducedOverride } = playback;
  useEffect(() => {
    if (params.get('reduced') === '1') setReducedOverride(true);
  }, [setReducedOverride]);

  const { pointer, handlers } = usePointerParallax(!playback.reduced && !exporting);
  const cardRef = useRef<ShareCardHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const displayWidth = useCardWidth(stageRef, layouts[ratio].height);
  const onArtworkError = useCallback((message: string) => setArtError(message), []);
  // Frozen review frames (?t=) never auto-play.
  const { replay } = playback;
  const onHeroReady = useCallback(() => {
    if (frozenAt === null) replay();
  }, [replay]);

  return (
    <div className="min-h-dvh text-violet-50">
      <main className="mx-auto grid max-w-[1240px] grid-cols-1 gap-8 px-4 pt-4 pb-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-10">
        <section aria-label="Xem trước thẻ" className="flex min-w-0 flex-col items-center gap-5">
          <div
            ref={stageRef}
            {...handlers}
            className="stage relative flex w-full touch-pan-y justify-center py-2"
          >
            <div className="relative">
              <ShareCard
                ref={cardRef}
                data={data}
                theme={theme}
                ratio={ratio}
                time={playback.time}
                reduced={playback.reduced}
                pointer={pointer}
                displayWidth={displayWidth}
                onArtworkError={onArtworkError}
                onHeroReady={onHeroReady}
              />
              {showSafe && safe && <SafeZoneGuides safe={safe} height={layouts[ratio].height} />}
            </div>
          </div>
          <AnimationController playback={playback} disabled={exporting} />
        </section>

        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start" aria-label="Tuỳ chỉnh thẻ">
          <Panel title="Nhóm tính cách">
            <div role="radiogroup" aria-label="Mẫu thẻ" className="grid grid-cols-2 gap-2">
              {archetypeIds.map((id) => {
                const { content, theme: t } = archetypes[id]!;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={archetypeId === id}
                    disabled={exporting}
                    onClick={() => {
                      if (id === archetypeId) return;
                      setArchetypeId(id);
                      setArtError(null);
                    }}
                    className="segment h-16 flex-row justify-start gap-3 px-3"
                  >
                    <span
                      aria-hidden="true"
                      className="size-9 shrink-0 rounded-lg bg-cover bg-center ring-1 ring-white/15"
                      style={{ backgroundImage: `url(${t.artwork.src})` }}
                    />
                    <span className="flex min-w-0 flex-col items-start">
                      <span className="truncate text-sm font-semibold">
                        {content.archetype.title}
                      </span>
                      <span className="truncate text-xs text-violet-200/60">
                        {content.archetype.subtitle}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Panel>
          <Panel title="Nội dung">
            <ContentEditor data={data} onChange={setData} disabled={exporting} />
          </Panel>
          <Panel title="Khung hình">
            <div role="radiogroup" aria-label="Tỉ lệ khung hình" className="grid grid-cols-2 gap-2">
              {(['9:16', '4:5'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={ratio === r}
                  disabled={exporting}
                  onClick={() => setRatio(r)}
                  className="segment"
                >
                  <span className="font-semibold">{r}</span>
                  <span className="text-xs text-violet-200/60">
                    {r === '9:16' ? 'Story' : 'Bài đăng'}
                  </span>
                </button>
              ))}
            </div>
            {safe && (
              <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 text-sm text-violet-100">
                <span>
                  Hiện vùng an toàn Story
                  <span className="block text-xs text-violet-200/55">
                    Giao diện Story che phần ngoài hai đường kẻ
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={showSafe}
                  onChange={(e) => setShowSafe(e.target.checked)}
                  className="size-5 accent-violet-400"
                />
              </label>
            )}
          </Panel>
          <Panel title="Artwork">
            <ArtworkInput
              current={theme.artwork}
              isCustom={customArt !== null}
              error={artError}
              disabled={exporting}
              onSelect={(asset) => {
                setArtError(null);
                setCustomArt(asset);
              }}
              onReset={() => {
                setArtError(null);
                setCustomArt(null);
              }}
            />
          </Panel>
          <Panel title="Xuất file">
            <ExportController
              cardRef={cardRef}
              ratio={ratio}
              name={data.name}
              onBusyChange={setExporting}
            />
          </Panel>
        </aside>
      </main>
    </div>
  );
}

/** Preview-only guides for the Story-safe band; never exported. */
function SafeZoneGuides({
  safe,
  height,
}: {
  safe: { top: number; bottom: number };
  height: number;
}) {
  const band = (from: number, to: number) => ({
    top: `${(from / height) * 100}%`,
    height: `${((to - from) / height) * 100}%`,
  });
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      {[band(0, safe.top), band(safe.bottom, height)].map((style, i) => (
        <div
          key={i}
          style={style}
          className={`absolute inset-x-0 border-dashed border-amber-200/80 bg-amber-300/10 ${i === 0 ? 'border-b' : 'border-t'}`}
        />
      ))}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5 backdrop-blur-md">
      <h2 className="mb-4 text-xs font-semibold tracking-[0.2em] text-violet-200/70 uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Largest card width that fits the stage width and a comfortable share of the viewport height. */
function useCardWidth(stage: React.RefObject<HTMLDivElement | null>, cardHeight: number) {
  const [width, setWidth] = useState(360);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const wide = window.matchMedia('(min-width: 1024px)').matches;
      const maxHeight = wide ? window.innerHeight - 250 : window.innerHeight * 0.8;
      const byHeight = (Math.max(420, maxHeight) * CARD_WIDTH) / cardHeight;
      const next = Math.floor(Math.min(el.clientWidth, byHeight, cardHeight > 600 ? 420 : 480));
      setWidth(Math.max(260, next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [stage, cardHeight]);
  return width;
}
