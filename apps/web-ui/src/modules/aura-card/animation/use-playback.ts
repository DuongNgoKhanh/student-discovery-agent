import {
  cancelFrame,
  frame,
  useMotionValue,
  useReducedMotion,
  type MotionValue,
} from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PlaybackClock } from './clock';
import { timelineConfig } from './config';

export interface Playback {
  time: MotionValue<number>;
  /** The OS asks for reduced motion: the card rests on its final frame. */
  reduced: boolean;
  /** Restart the introduction from the beginning and play. */
  replay(): void;
}

/**
 * Owns the playback clock and the shared `time` motion value. Frames are scheduled only while
 * playing, the page is visible, the card is not `suspended` (off screen, exporting) and reduced
 * motion is off. Starts paused: call `replay()` once the artwork is ready.
 */
export function usePlayback({ suspended = false }: { suspended?: boolean } = {}): Playback {
  const reduced = useReducedMotion() ?? false;
  const [playing, setPlaying] = useState(false);
  const time = useMotionValue(0);
  const clock = useRef<PlaybackClock | null>(null);
  if (!clock.current) clock.current = new PlaybackClock();

  useEffect(() => {
    const c = clock.current!;
    if (reduced) {
      time.set(timelineConfig.stillTime);
      return;
    }
    time.set(c.time(performance.now()));
    if (!playing || suspended) return;

    const tick = () => time.set(c.time(performance.now()));
    const start = () => {
      c.play(performance.now());
      frame.update(tick, true);
    };
    const stop = () => {
      cancelFrame(tick);
      c.pause(performance.now());
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [playing, reduced, suspended, time]);

  const replay = useCallback(() => {
    clock.current!.seek(0, performance.now());
    if (!reduced) time.set(0);
    setPlaying(true);
  }, [reduced, time]);

  return { time, reduced, replay };
}
