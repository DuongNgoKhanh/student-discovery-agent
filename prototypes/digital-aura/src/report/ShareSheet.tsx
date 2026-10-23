import { useMotionValue } from 'motion/react';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { timelineConfig } from '../sharecard/animation/config';
import { ExportController } from '../sharecard/components/ExportController';
import { ShareCard, type ShareCardHandle } from '../sharecard/components/ShareCard';
import type { ArchetypeTheme, CardRatio, ShareCardData } from '../sharecard/types';
import { withoutFamilyName } from './names';

interface ShareSheetProps {
  open: boolean;
  onClose(): void;
  data: ShareCardData;
  theme: ArchetypeTheme;
}

/**
 * Share step: pick a format, optionally hide the family name (users are mostly minors),
 * preview the exact card and export it. Native <dialog> provides focus trapping and Esc.
 * The preview is a still frame; exports always render the full animation.
 */
export function ShareSheet({ open, onClose, data, theme }: ShareSheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cardRef = useRef<ShareCardHandle>(null);
  const [ratio, setRatio] = useState<CardRatio>('9:16');
  const [hideFamily, setHideFamily] = useState(true);
  const [busy, setBusy] = useState(false);
  const still = useMotionValue(timelineConfig.stillTime);
  const shared = { ...data, name: hideFamily ? withoutFamilyName(data.name) : data.name };

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={(e) => busy && e.preventDefault()}
      aria-labelledby="share-title"
      className="share-sheet m-auto w-[min(720px,calc(100vw-24px))] rounded-3xl border border-white/12 bg-[#0d0b1f]/95 p-0 text-violet-50 backdrop:bg-black/60 backdrop:backdrop-blur-sm max-sm:mb-0 max-sm:w-full max-sm:rounded-b-none"
    >
      {open && (
        <div className="flex max-h-[min(92dvh,860px)] flex-col">
          <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <h2 id="share-title" className="font-display text-2xl font-semibold">
              Chia sẻ thẻ
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="icon-button"
              aria-label="Đóng"
            >
              <X size={18} aria-hidden />
            </button>
          </header>
          <div className="grid gap-6 overflow-y-auto p-5 sm:grid-cols-[auto_1fr]">
            <div className="flex justify-center">
              <ShareCard
                ref={cardRef}
                data={shared}
                theme={theme}
                ratio={ratio}
                time={still}
                reduced={false}
                displayWidth={ratio === '9:16' ? 210 : 250}
              />
            </div>
            <div className="space-y-5">
              <fieldset disabled={busy}>
                <legend className="field-label">Khung hình</legend>
                <div
                  role="radiogroup"
                  aria-label="Tỉ lệ khung hình"
                  className="grid grid-cols-2 gap-2"
                >
                  {(['9:16', '4:5'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="radio"
                      aria-checked={ratio === r}
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
              </fieldset>
              <label className="flex cursor-pointer items-start justify-between gap-3 text-sm">
                <span>
                  Ẩn họ, chỉ hiện tên
                  <span className="block text-xs text-violet-200/60">
                    Thẻ sẽ hiện “{withoutFamilyName(data.name)}”. Nên bật khi đăng công khai.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={hideFamily}
                  disabled={busy}
                  onChange={(e) => setHideFamily(e.target.checked)}
                  className="mt-0.5 size-5 accent-violet-400"
                />
              </label>
              <ExportController
                cardRef={cardRef}
                ratio={ratio}
                name={shared.name}
                onBusyChange={setBusy}
              />
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}
