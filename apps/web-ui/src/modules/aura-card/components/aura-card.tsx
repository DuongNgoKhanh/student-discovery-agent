'use client';

import { Download, Loader2, RotateCcw, Share2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import { usePlayback } from '../animation/use-playback';
import type { ArchetypeEntry } from '../content';
import { download, fileStem } from '../export/files';
import { exportPng } from '../export/png';
import { cardSans, cardTitle } from '../fonts';
import { exportSizes } from '../layout';
import type { CardRatio, ShareCardData } from '../types';
import { ShareCard, type ShareCardHandle } from './share-card';

interface AuraCardProps {
  entry: ArchetypeEntry;
  /** The student's display name, shown on the card. */
  name: string;
  /** Demo results carry a visible "Demo" badge, on screen and in the saved image. */
  demo: boolean;
}

/** Card width cap per format, in CSS pixels: a Story card stays readable without filling the chat. */
const MAX_WIDTH: Record<CardRatio, number> = { '9:16': 340, '4:5': 400 };

const RATIOS: { value: CardRatio; label: string }[] = [
  { value: '9:16', label: 'Story 9:16' },
  { value: '4:5', label: 'Bài đăng 4:5' },
];

type Status = { state: 'idle' } | { state: 'busy' } | { state: 'error'; message: string };

/**
 * The animated result card with its share actions. The introduction plays once the artwork is
 * ready and only while the card is on screen; saving renders a full-resolution PNG of the
 * resting card in the chosen format.
 */
export function AuraCard({ entry, name, demo }: AuraCardProps) {
  const [ratio, setRatio] = useState<CardRatio>('9:16');
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const [artworkError, setArtworkError] = useState(false);
  const { width, visible, ref: boxRef } = useBoxWidth();
  const { time, reduced, replay } = usePlayback({ suspended: !visible || status.state === 'busy' });
  const cardRef = useRef<ShareCardHandle>(null);
  const canShare = useCanShareFiles();

  const data = useMemo<ShareCardData>(
    () => ({ ...entry.content, name, badge: demo ? 'Demo' : undefined }),
    [entry.content, name, demo],
  );
  const displayWidth = Math.min(width, MAX_WIDTH[ratio]);
  const busy = status.state === 'busy';

  async function renderPng() {
    const renderer = await cardRef.current!.createRenderer();
    return exportPng(renderer, exportSizes[ratio]);
  }

  async function save() {
    setStatus({ state: 'busy' });
    try {
      download(await renderPng(), `${fileStem(name, ratio)}.png`);
      setStatus({ state: 'idle' });
    } catch {
      setStatus({ state: 'error', message: 'Không lưu được ảnh. Hãy thử lại.' });
    }
  }

  async function share() {
    setStatus({ state: 'busy' });
    try {
      const file = new File([await renderPng()], `${fileStem(name, ratio)}.png`, {
        type: 'image/png',
      });
      await navigator.share({ files: [file], title: `${name} — ${entry.content.archetype.title}` });
      setStatus({ state: 'idle' });
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (error instanceof DOMException && error.name === 'AbortError')
        setStatus({ state: 'idle' });
      else
        setStatus({ state: 'error', message: 'Không chia sẻ được ảnh. Hãy lưu ảnh rồi chia sẻ.' });
    }
  }

  return (
    <div
      className={cn(
        cardSans.variable,
        cardTitle.variable,
        'flex w-full flex-col items-center gap-3',
      )}
    >
      <div ref={boxRef} className="flex w-full justify-center">
        {width > 0 && !artworkError && (
          <ShareCard
            ref={cardRef}
            data={data}
            theme={entry.theme}
            ratio={ratio}
            time={time}
            reduced={reduced}
            displayWidth={displayWidth}
            onHeroReady={replay}
            onArtworkError={() => setArtworkError(true)}
          />
        )}
        {artworkError && (
          <p role="alert" className="py-6 text-sm text-muted-foreground">
            Không tải được hình thẻ. Hãy tải lại trang.
          </p>
        )}
      </div>

      <div
        className="flex w-full flex-wrap items-center justify-center gap-2"
        style={{ maxWidth: MAX_WIDTH['4:5'] }}
      >
        <div role="radiogroup" aria-label="Khổ ảnh" className="flex rounded-lg bg-muted p-0.5">
          {RATIOS.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={ratio === r.value}
              disabled={busy}
              onClick={() => setRatio(r.value)}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-checked:bg-card aria-checked:text-foreground aria-checked:shadow-sm"
            >
              {r.label}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={save} disabled={busy || artworkError}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          Lưu ảnh
        </Button>
        {canShare && (
          <Button size="sm" variant="outline" onClick={share} disabled={busy || artworkError}>
            <Share2 className="h-4 w-4" aria-hidden="true" />
            Chia sẻ
          </Button>
        )}
        {!reduced && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={replay}
            disabled={busy}
            aria-label="Xem lại hiệu ứng"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      <p aria-live="polite" className="min-h-4 text-xs text-destructive">
        {status.state === 'error' ? status.message : ''}
      </p>
    </div>
  );
}

/** Width of the card's slot, and whether it is on screen (off screen, playback pauses). */
function useBoxWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const resize = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    const seen = new IntersectionObserver(([entry]) => setVisible(entry!.isIntersecting));
    resize.observe(el);
    seen.observe(el);
    return () => {
      resize.disconnect();
      seen.disconnect();
    };
  }, []);
  return { ref, width, visible };
}

/** Web Share with files (mostly phones). Checked after mount, so server and client markup match. */
function useCanShareFiles() {
  const [canShare, setCanShare] = useState(false);
  useEffect(() => {
    try {
      const probe = new File([''], 'card.png', { type: 'image/png' });
      setCanShare(
        typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] }),
      );
    } catch {
      setCanShare(false);
    }
  }, []);
  return canShare;
}
