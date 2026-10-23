import { Clapperboard, Image as ImageIcon, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { VideoSupport } from '../export/exporters';
import { download, fileStem } from '../export/files';
import { exportSizes } from '../layout';
import type { CardRatio } from '../types';
import type { ShareCardHandle } from './ShareCard';

// Encoders (Mediabunny) load on demand, off the first-paint path.
const loadExporters = () => import('../export/exporters');

interface ExportControllerProps {
  cardRef: RefObject<ShareCardHandle | null>;
  ratio: CardRatio;
  name: string;
  onBusyChange(busy: boolean): void;
}

type Status =
  | { state: 'idle' }
  | { state: 'png' }
  | { state: 'video'; progress: number }
  | { state: 'done'; message: string }
  | { state: 'error'; message: string };

export function ExportController({ cardRef, ratio, name, onBusyChange }: ExportControllerProps) {
  const size = exportSizes[ratio];
  const [support, setSupport] = useState<VideoSupport | null>(null);
  const [status, setStatus] = useState<Status>({ state: 'idle' });
  const abort = useRef<AbortController | null>(null);
  const busy = status.state === 'png' || status.state === 'video';

  useEffect(() => {
    let live = true;
    void loadExporters()
      .then(({ detectVideoSupport }) => detectVideoSupport(size))
      .then((s) => live && setSupport(s));
    return () => {
      live = false;
    };
  }, [size]);

  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  useEffect(() => () => abort.current?.abort(), []);

  const stem = fileStem(name, ratio);

  async function savePng() {
    setStatus({ state: 'png' });
    try {
      const [{ exportPng }, renderer] = await Promise.all([
        loadExporters(),
        cardRef.current!.createRenderer(),
      ]);
      download(await exportPng(renderer, size), `${stem}.png`);
      setStatus({ state: 'done', message: `Đã lưu ${stem}.png (${size.width}×${size.height}).` });
    } catch (error) {
      setStatus({ state: 'error', message: messageOf(error) });
    }
  }

  async function saveVideo() {
    if (!support || support.kind === 'none') return;
    const controller = new AbortController();
    abort.current = controller;
    setStatus({ state: 'video', progress: 0 });
    try {
      const [{ exportVideo }, renderer] = await Promise.all([
        loadExporters(),
        cardRef.current!.createRenderer(),
      ]);
      let last = 0;
      const blob = await exportVideo({
        renderer,
        size,
        support,
        signal: controller.signal,
        onProgress: (p) => {
          // Throttle React updates to whole percents.
          if (Math.floor(p * 100) !== last) {
            last = Math.floor(p * 100);
            setStatus({ state: 'video', progress: p });
          }
        },
      });
      const file = `${stem}.${support.container}`;
      download(blob, file);
      setStatus({
        state: 'done',
        message: `Đã lưu ${file} (6 giây, ${size.width}×${size.height}).`,
      });
    } catch (error) {
      setStatus(
        error instanceof DOMException && error.name === 'AbortError'
          ? { state: 'idle' }
          : { state: 'error', message: messageOf(error) },
      );
    } finally {
      abort.current = null;
    }
  }

  const videoLabel =
    support === null
      ? 'Đang kiểm tra…'
      : support.kind === 'none'
        ? 'Video không khả dụng'
        : `Video ${support.container.toUpperCase()}`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={savePng} disabled={busy} className="action-button">
          {status.state === 'png' ? (
            <LoaderCircle size={17} className="animate-spin" aria-hidden />
          ) : (
            <ImageIcon size={17} aria-hidden />
          )}
          Ảnh PNG
        </button>
        <button
          type="button"
          onClick={saveVideo}
          disabled={busy || !support || support.kind === 'none'}
          className="action-button action-button-primary"
        >
          <Clapperboard size={17} aria-hidden />
          {videoLabel}
        </button>
      </div>
      <p className="text-xs leading-relaxed text-violet-200/60">
        {size.width}×{size.height}px. PNG là khung hình tĩnh hoàn chỉnh; video là đoạn giới thiệu 6
        giây, 30 fps
        {support?.kind === 'recorder' ? ', ghi theo thời gian thực — giữ tab này mở' : ''}.
      </p>

      <div aria-live="polite" className="min-h-5 text-sm">
        {status.state === 'video' && (
          <div className="flex items-center gap-3">
            <div
              role="progressbar"
              aria-label="Tiến độ xuất video"
              aria-valuenow={Math.round(status.progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10"
            >
              <div
                className="h-full origin-left rounded-full bg-gradient-to-r from-sky-300 to-violet-400"
                style={{ transform: `scaleX(${status.progress})` }}
              />
            </div>
            <span className="w-10 text-right text-xs text-violet-200/70 tabular-nums">
              {Math.round(status.progress * 100)}%
            </span>
            <button
              type="button"
              onClick={() => abort.current?.abort()}
              className="icon-button"
              aria-label="Huỷ xuất video"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        )}
        {status.state === 'done' && <p className="text-emerald-200/90">{status.message}</p>}
        {status.state === 'error' && (
          <p role="alert" className="text-rose-200">
            {status.message}
          </p>
        )}
        {support?.kind === 'none' && <p className="text-violet-200/60">{support.reason}</p>}
      </div>
    </div>
  );
}

function messageOf(error: unknown) {
  return error instanceof Error ? `Xuất thất bại: ${error.message}` : 'Xuất thất bại.';
}
