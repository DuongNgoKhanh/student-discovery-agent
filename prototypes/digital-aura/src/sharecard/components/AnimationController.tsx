import { useMotionValueEvent } from 'motion/react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
import { timelineConfig } from '../animation/config';
import { phaseAt } from '../animation/timeline';
import type { Playback } from '../animation/use-playback';

interface AnimationControllerProps {
  playback: Playback;
  disabled?: boolean;
}

const DURATION = timelineConfig.duration;

/** Play / pause / replay, a scrubber over the 6 s introduction, and the reduced-motion switch. */
export function AnimationController({ playback, disabled = false }: AnimationControllerProps) {
  const { time, playing, reduced, systemReduced } = playback;
  const scrubber = useRef<HTMLInputElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const [phase, setPhase] = useState(() => phaseAt(time.get(), reduced).id);

  // Imperative updates: the scrubber and readout follow time without re-rendering React.
  useMotionValueEvent(time, 'change', (t) => {
    if (scrubber.current && !dragging.current)
      scrubber.current.value = String(Math.min(t, DURATION));
    if (readout.current) {
      readout.current.textContent = t > DURATION ? 'loop' : `${(t / 1000).toFixed(1)}s`;
    }
    const next = phaseAt(t, reduced).id;
    if (next !== phase) setPhase(next);
  });

  const transportDisabled = disabled || reduced;

  return (
    <div className="w-full max-w-[460px] rounded-2xl border border-white/10 bg-white/[0.04] p-3 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={playback.togglePlay}
          disabled={transportDisabled}
          aria-pressed={!playing}
          className="control-button w-[124px] whitespace-nowrap"
        >
          {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          {playing ? 'Tạm dừng' : 'Phát'}
        </button>
        <button
          type="button"
          onClick={playback.replay}
          disabled={transportDisabled}
          className="control-button"
        >
          <RotateCcw size={16} aria-hidden />
          Phát lại
        </button>
        <span
          ref={readout}
          aria-hidden="true"
          className="ml-auto w-12 text-right font-mono text-xs text-violet-200/70 tabular-nums"
        >
          {time.get() > DURATION ? 'loop' : `${(time.get() / 1000).toFixed(1)}s`}
        </span>
      </div>

      <label className="mt-3 block">
        <span className="sr-only">Vị trí trong đoạn giới thiệu 6 giây</span>
        <input
          ref={scrubber}
          type="range"
          min={0}
          max={DURATION}
          step={10}
          defaultValue={Math.min(time.get(), DURATION)}
          disabled={transportDisabled}
          onPointerDown={() => (dragging.current = true)}
          onPointerUp={() => (dragging.current = false)}
          onBlur={() => (dragging.current = false)}
          onChange={(e) => playback.seek(Number(e.target.value))}
          className="scrubber w-full"
        />
      </label>

      <ol
        className="mt-1 grid grid-cols-[1.2fr_1.3fr_1fr_2.5fr] gap-1 text-[11px]"
        aria-label="Các pha chuyển động"
      >
        {timelineConfig.phases.map((p) => (
          <li
            key={p.id}
            aria-current={p.id === phase ? 'step' : undefined}
            className={`truncate border-t pt-1 transition-colors duration-300 ${
              p.id === phase
                ? 'border-violet-300 text-violet-100'
                : 'border-white/10 text-violet-200/45'
            }`}
          >
            {p.label}
          </li>
        ))}
      </ol>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
        <label htmlFor="reduced-motion" className="text-sm text-violet-100">
          Giảm chuyển động
          <span className="block text-xs text-violet-200/55">
            {systemReduced ? 'Hệ thống đang bật' : 'Theo cài đặt hệ thống: tắt'}
          </span>
        </label>
        <button
          id="reduced-motion"
          type="button"
          role="switch"
          aria-checked={reduced}
          onClick={() => playback.setReducedOverride(!reduced)}
          disabled={disabled}
          className="switch"
        >
          <span className="switch-thumb" />
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
        <label htmlFor="auto-replay" className="text-sm text-violet-100">
          Tự phát lại
          <span className="block text-xs text-violet-200/55">
            {reduced ? 'Không áp dụng khi giảm chuyển động' : 'Lặp lại đoạn giới thiệu 6 giây'}
          </span>
        </label>
        <button
          id="auto-replay"
          type="button"
          role="switch"
          aria-checked={playback.autoReplay}
          onClick={() => playback.setAutoReplay(!playback.autoReplay)}
          disabled={disabled || reduced}
          className="switch"
        >
          <span className="switch-thumb" />
        </button>
      </div>
    </div>
  );
}
