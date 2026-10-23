import { ImageUp, TriangleAlert, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ArtworkAsset } from '../sharecard/types';

interface ArtworkInputProps {
  current: ArtworkAsset;
  isCustom: boolean;
  error: string | null;
  onSelect(asset: ArtworkAsset): void;
  onReset(): void;
  disabled?: boolean;
}

const ACCEPT = ['image/png', 'image/webp', 'image/jpeg', 'image/avif'];
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Lets a designer drop in the final hero artwork. Uploaded files stay in memory (object URL);
 * nothing is sent anywhere.
 */
export function ArtworkInput({
  current,
  isCustom,
  error,
  onSelect,
  onReset,
  disabled,
}: ArtworkInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function choose(file: File | undefined) {
    setProblem(null);
    if (!file) return;
    if (!ACCEPT.includes(file.type)) return setProblem('Chọn tệp PNG, WebP, JPG hoặc AVIF.');
    if (file.size > MAX_BYTES) return setProblem('Tệp lớn hơn 15 MB.');
    const src = URL.createObjectURL(file);
    urls.current.push(src);
    const img = new Image();
    img.src = src;
    try {
      await img.decode();
    } catch {
      return setProblem('Không đọc được ảnh này.');
    }
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    onSelect({
      src,
      alt: 'Artwork tuỳ chỉnh của nhóm tính cách',
      provenance: `${file.name} · ${img.naturalWidth}×${img.naturalHeight}px (tải lên)`,
      focal: { x: 0.5, y: 0.55 },
      bodyAxis: [
        { x: 0.5, y: 0.35 },
        { x: 0.5, y: 0.8 },
      ],
      facets: [{ x: 0.5, y: 0.55, size: 0.9 }],
      erase: [],
      feather: { top: 0.06, bottom: 0.22, side: 0.04 },
      qualityNote:
        side < 1200 ? `Ảnh ${side}px hơi nhỏ cho bản xuất 1080px; nên dùng ≥1600px.` : undefined,
    });
  }

  const note = error ?? problem;

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-violet-200/65">{current.provenance}</p>
      {current.qualityNote && (
        <p className="flex gap-2 rounded-xl border border-amber-300/25 bg-amber-300/[0.07] p-3 text-xs leading-relaxed text-amber-100/90">
          <TriangleAlert size={15} className="mt-px shrink-0" aria-hidden />
          {current.qualityNote}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={disabled}
          className="action-button flex-1"
        >
          <ImageUp size={17} aria-hidden />
          Thay artwork
        </button>
        {isCustom && (
          <button type="button" onClick={onReset} disabled={disabled} className="action-button">
            <Undo2 size={17} aria-hidden />
            Ảnh gốc
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void choose(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {note && (
        <p role="alert" className="text-sm text-rose-200">
          {note}
        </p>
      )}
    </div>
  );
}
