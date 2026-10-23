import { cubicBezier } from 'motion/react';
import { timelineConfig, type PhaseSpec, type Range, type TimelineConfig } from './config';

/**
 * Pure timeline sampling. The canvas painters, the DOM overlay and the exporters all read
 * from these functions, so a given time always produces the same frame everywhere.
 *
 * Time is absolute and never wraps: after the introduction the identity stays revealed and
 * only periodic ambient terms keep moving.
 */

const cinematic = cubicBezier(0.16, 1, 0.3, 1);
const gentle = cubicBezier(0.65, 0, 0.35, 1);
const TAU = Math.PI * 2;

export const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
export const progress = (t: number, [a, b]: Range) => clamp01((t - a) / (b - a));
const smooth = (n: number) => n * n * (3 - 2 * n);
/** 0 → 1 → 0 cosine wave with the given period. */
const wave = (t: number, period: number) => 0.5 - 0.5 * Math.cos((t / period) * TAU);

export interface SceneSample {
  t: number;
  reduced: boolean;
  atmosphere: number;
  converge: number;
  reveal: number;
  heroScale: number;
  bloom: number;
  ribbons: number;
  /** Seconds that drive ribbon orbits and particle drift. */
  clock: number;
  sweep: number | null;
  /** Wing foreshortening, 0 = flat open wings. */
  wing: number;
  pulse: number;
  float: number;
  ambient: number;
}

export function sampleScene(
  time: number,
  reduced = false,
  config: TimelineConfig = timelineConfig,
): SceneSample {
  const t = reduced ? config.stillTime : Math.max(0, time);
  const s = config.scene;
  const a = config.ambient;
  const ambient = reduced ? 0 : smooth(progress(t, s.ambientIn));
  const floatIn = reduced ? 0 : smooth(progress(t, s.floatIn));
  const pulse = reduced ? 0.5 : wave(t, a.pulsePeriod) * smooth(progress(t, [2200, 3400]));
  const sinceBloom = (t - s.bloomPeak) / 420;
  const flash = Math.exp(-sinceBloom * sinceBloom);
  return {
    t,
    reduced,
    atmosphere: gentle(progress(t, s.atmosphere)),
    converge: gentle(progress(t, s.converge)),
    reveal: gentle(progress(t, s.reveal)),
    heroScale: 0.9 + 0.1 * cinematic(progress(t, s.heroScale)),
    bloom: (reduced ? 0 : flash * 0.7) + 0.42 * progress(t, s.reveal) + 0.18 * pulse,
    ribbons: cinematic(progress(t, s.ribbons)),
    clock: t / 1000,
    sweep: t >= s.sweep[0] && t <= s.sweep[1] && !reduced ? gentle(progress(t, s.sweep)) : null,
    wing: a.wingAmplitude * ambient * wave(t - s.ambientIn[0], a.wingPeriod),
    pulse,
    float: Math.sin(((t - s.floatIn[0]) / a.floatPeriod) * TAU) * a.floatAmplitude * floatIn,
    ambient,
  };
}

/** Light emitted by crystal facet `index`: a staggered flare during the aura sweep, then a pulse. */
export function facetGlow(sample: SceneSample, index: number, config = timelineConfig) {
  const f = config.scene.facets;
  const start = f.start + index * f.stagger;
  const rise = progress(sample.t, [start, start + f.rise]);
  const settle = progress(sample.t, [start + f.rise, start + f.rise + f.settle]);
  const flare = sample.reduced ? 0 : rise * (1 - settle);
  const rest = 0.32 * rise;
  return flare + rest + 0.38 * sample.pulse * rise;
}

/** Halo intensity: builds through the aura sweep, flares once, then breathes with the pulse. */
export function haloGlow(sample: SceneSample, config = timelineConfig) {
  const h = config.scene.halo;
  const rise = progress(sample.t, h.rise);
  const d = (sample.t - h.flare) / 380;
  const flare = sample.reduced ? 0 : Math.exp(-d * d) * 0.9;
  return rise * (0.45 + 0.35 * sample.pulse) + flare;
}

/**
 * Rhythmic facet flash: on each beat one facet (cycling through `count`) flashes with a sharp
 * attack and exponential decay. Only during the ambient loop, never in reduced motion.
 */
export function beatGlow(sample: SceneSample, index: number, count: number, bpm: number) {
  if (sample.reduced || sample.ambient <= 0 || count <= 0) return 0;
  const beat = 60000 / bpm;
  const n = Math.floor(sample.t / beat);
  if (n % count !== index) return 0;
  return Math.exp(-((sample.t - n * beat) / beat) * 4) * sample.ambient;
}

export type OverlayTrack = 'header' | 'name' | 'title' | 'subtitle' | 'chips' | 'footer';

/**
 * How the identity typography enters. Each archetype picks one; all share the 2.5–3.5 s window.
 * - blur: letters rise out of a blur (default)
 * - bloom: letters grow and untwist like opening petals
 * - scramble: letters cycle through random glyphs, then lock (rendered via `scrambleGlyph`)
 * - breath: the whole title surfaces slowly and softly, no movement
 * - path: letters light up left to right, sliding along a path; chips follow like stepping stones
 * - beat: letters and chips pop in quantised to the 80 BPM grid
 * - word: one word at a time (callers pass word index/count instead of letter index/count)
 */
export type TitleStyle = 'blur' | 'bloom' | 'scramble' | 'breath' | 'path' | 'beat' | 'word';

export interface OverlayStyle {
  opacity: number;
  /** Offsets in card units. */
  x: number;
  y: number;
  /** Blur radius in card units. */
  blur: number;
  scale: number;
  /** Degrees. */
  rotate: number;
}

const trackRise: Record<OverlayTrack, { y: number; blur: number }> = {
  header: { y: 0, blur: 0 },
  name: { y: 10, blur: 4 },
  title: { y: 16, blur: 8 },
  subtitle: { y: 8, blur: 3 },
  chips: { y: 12, blur: 0 },
  footer: { y: 6, blur: 0 },
};

/** Sixteenth note at 80 BPM, the grid for the `beat` style. */
const SIXTEENTH = 60000 / 80 / 4;
const quantise = (t: number) => Math.round(t / SIXTEENTH) * SIXTEENTH;

function staggered(
  window: Range,
  duration: number,
  maxStagger: number,
  index: number,
  count: number,
): Range {
  const [start, end] = window;
  const stagger = count > 1 ? Math.min(maxStagger, (end - start - duration) / (count - 1)) : 0;
  const s = start + Math.max(0, stagger) * index;
  return [s, s + duration];
}

function trackRange(
  track: OverlayTrack,
  index: number,
  count: number,
  style: TitleStyle,
  config: TimelineConfig,
): Range {
  const o = config.overlay;
  if (track === 'title') {
    const { window, letter, maxStagger } = o.title;
    switch (style) {
      case 'breath':
        return staggered([2550, 3450], 850, 10, index, count);
      case 'path':
        return staggered(window, 360, 60, index, count);
      case 'scramble':
        // Letters appear almost at once; each then locks in sequence (see scrambleGlyph).
        return staggered([2550, 2800], 160, 14, index, count);
      case 'beat': {
        const [s] = staggered(window, 160, 60, index, count);
        const q = quantise(s);
        return [q, q + 160];
      }
      case 'word':
        return staggered([2600, 3300], 520, 320, index, count);
      default:
        return staggered(window, letter, maxStagger, index, count);
    }
  }
  if (track === 'chips') {
    if (style === 'path') {
      const s = 3000 + 160 * index;
      return [s, s + 340];
    }
    if (style === 'beat') {
      const q = quantise(3000 + SIXTEENTH * index);
      return [q, q + 180];
    }
    const s = o.chips.start + o.chips.stagger * index;
    return [s, s + o.chips.duration];
  }
  return o[track];
}

const easeOutBack = (n: number) => {
  const c = 1.9;
  return 1 + (c + 1) * (n - 1) ** 3 + c * (n - 1) ** 2;
};

/**
 * Overlay element style at a time. `index`/`count` stagger letters (or words) and chips;
 * `style` is the archetype's title style.
 */
export function overlayStyle(
  track: OverlayTrack,
  time: number,
  reduced = false,
  index = 0,
  count = 1,
  style: TitleStyle = 'blur',
  config: TimelineConfig = timelineConfig,
): OverlayStyle {
  const t = reduced ? config.stillTime : time;
  const p = progress(t, trackRange(track, index, count, style, config));
  const e = cinematic(p);
  const rest: OverlayStyle = { opacity: e, x: 0, y: 0, blur: 0, scale: 1, rotate: 0 };
  const rise = trackRise[track];

  if (track === 'title') {
    switch (style) {
      case 'bloom':
        return { ...rest, scale: 0.55 + 0.45 * e, rotate: (e - 1) * 10, blur: (1 - e) * 3 };
      case 'scramble':
        return { ...rest, opacity: Math.min(1, p * 3) };
      case 'breath': {
        const g = gentle(p);
        return { ...rest, opacity: g, blur: (1 - g) * 2.5, scale: 0.985 + 0.015 * g };
      }
      case 'path':
        return { ...rest, x: (e - 1) * 14 };
      case 'beat':
        return { ...rest, opacity: p > 0 ? 1 : 0, scale: p > 0 ? easeOutBack(p) * 0.25 + 0.75 : 1 };
      case 'word':
        return { ...rest, y: (1 - e) * 8, blur: (1 - e) * 5 };
    }
  }
  if (track === 'chips' && style === 'path') return { ...rest, x: (e - 1) * 16 };
  if (track === 'chips' && style === 'beat') {
    return { ...rest, opacity: p > 0 ? 1 : 0, scale: p > 0 ? easeOutBack(p) * 0.2 + 0.8 : 1 };
  }
  return { ...rest, y: (1 - e) * rise.y, blur: (1 - e) * rise.blur };
}

const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVXYZ0123456789#%&*+<>/=?';

/**
 * For the `scramble` title: the glyph to show instead of the real letter, or null once the
 * letter has locked. Deterministic in time so preview and export match frame for frame.
 */
export function scrambleGlyph(
  time: number,
  index: number,
  count: number,
  reduced = false,
): string | null {
  if (reduced) return null;
  const lockAt = 2750 + (count > 1 ? (550 * index) / (count - 1) : 0);
  if (time >= lockAt) return null;
  const tick = Math.floor(time / 55);
  const n = Math.abs(Math.imul(tick * 31 + index * 97, 2654435761) >>> 0);
  return GLYPHS[n % GLYPHS.length]!;
}

export function phaseAt(time: number, reduced = false, config = timelineConfig): PhaseSpec {
  const t = reduced ? config.stillTime : time;
  return (
    config.phases.find(({ range }) => t >= range[0] && t < range[1]) ??
    config.phases[config.phases.length - 1]!
  );
}
