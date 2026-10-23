import {
  cancelFrame,
  frame,
  useMotionValue,
  useReducedMotion,
  useSpring,
  type MotionValue,
} from 'motion/react';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { PlaybackClock } from './clock';
import { timelineConfig } from './config';

export interface Playback {
  time: MotionValue<number>;
  playing: boolean;
  /** Effective reduced motion: the user's override, else the OS preference. */
  reduced: boolean;
  systemReduced: boolean;
  togglePlay(): void;
  replay(): void;
  seek(time: number): void;
  setReducedOverride(value: boolean | null): void;
  /** Restart the introduction automatically each time it reaches the end. */
  autoReplay: boolean;
  setAutoReplay(value: boolean): void;
}

const AUTO_REPLAY_KEY = 'sda-sharecard:auto-replay';

function readAutoReplay() {
  try {
    return localStorage.getItem(AUTO_REPLAY_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Owns the playback clock and the shared `time` motion value. Frames are scheduled only
 * while playing, visible, not suspended (e.g. exporting) and not in reduced motion.
 */
export function usePlayback({
  initialTime = 0,
  startPaused = false,
  suspended = false,
  initialAutoReplay,
}: {
  initialTime?: number;
  startPaused?: boolean;
  suspended?: boolean;
  /** Overrides the remembered auto-replay preference. */
  initialAutoReplay?: boolean;
} = {}): Playback {
  const systemReduced = useReducedMotion() ?? false;
  const [override, setReducedOverride] = useState<boolean | null>(null);
  const reduced = override ?? systemReduced;
  const [playing, setPlaying] = useState(!startPaused);
  const time = useMotionValue(initialTime);
  const [autoReplay, setAutoReplayState] = useState(() => initialAutoReplay ?? readAutoReplay());
  // Read inside the frame loop without restarting it.
  const autoReplayRef = useRef(autoReplay);
  autoReplayRef.current = autoReplay;
  const clock = useRef<PlaybackClock>(null as unknown as PlaybackClock);
  if (!clock.current) {
    clock.current = new PlaybackClock();
    clock.current.seek(initialTime, 0);
  }

  useEffect(() => {
    const c = clock.current;
    if (reduced) {
      time.set(timelineConfig.stillTime);
      return;
    }
    time.set(c.time(performance.now()));
    if (!playing || suspended) return;

    const tick = () => {
      const now = performance.now();
      if (autoReplayRef.current && c.time(now) >= timelineConfig.duration) c.seek(0, now);
      time.set(c.time(now));
    };
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

  const seek = useCallback(
    (t: number) => {
      clock.current.seek(t, performance.now());
      if (!reduced) time.set(t);
    },
    [reduced, time],
  );

  const replay = useCallback(() => {
    seek(0);
    setPlaying(true);
  }, [seek]);

  const setAutoReplay = useCallback((value: boolean) => {
    setAutoReplayState(value);
    try {
      localStorage.setItem(AUTO_REPLAY_KEY, value ? '1' : '0');
    } catch {
      // Storage unavailable (private mode, blocked): the setting just isn't remembered.
    }
  }, []);

  return {
    time,
    playing,
    reduced,
    systemReduced,
    togglePlay: () => setPlaying((p) => !p),
    replay,
    seek,
    setReducedOverride,
    autoReplay,
    setAutoReplay,
  };
}

/**
 * Spring-smoothed pointer position over an element, -1..1. Mouse and pen only: touch
 * scrolling must never tilt the card.
 */
export function usePointerParallax(enabled: boolean) {
  const spring = { stiffness: 120, damping: 20, mass: 0.7 };
  const x = useSpring(0, spring);
  const y = useSpring(0, spring);

  useEffect(() => {
    if (!enabled) {
      x.jump(0);
      y.jump(0);
    }
  }, [enabled, x, y]);

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!enabled || event.pointerType === 'touch') return;
      const rect = event.currentTarget.getBoundingClientRect();
      x.set(((event.clientX - rect.left) / rect.width) * 2 - 1);
      y.set(((event.clientY - rect.top) / rect.height) * 2 - 1);
    },
    [enabled, x, y],
  );
  const onPointerLeave = useCallback(() => {
    x.set(0);
    y.set(0);
  }, [x, y]);

  return { pointer: { x, y }, handlers: { onPointerMove, onPointerLeave } };
}
