/** Motion configuration. Times are in milliseconds from the start of the introduction. */

export type Range = readonly [start: number, end: number];

export interface PhaseSpec {
  id: 'reveal' | 'aura' | 'identity' | 'ambient';
  label: string;
  range: Range;
}

export interface TimelineConfig {
  /** Length of the authored introduction (and of exported video). */
  duration: number;
  /** Frame used for reduced motion and the static PNG: fully revealed, ambient at rest. */
  stillTime: number;
  phases: readonly PhaseSpec[];
  scene: {
    atmosphere: Range;
    converge: Range;
    reveal: Range;
    heroScale: Range;
    bloomPeak: number;
    ribbons: Range;
    facets: { start: number; stagger: number; rise: number; settle: number };
    sweep: Range;
    floatIn: Range;
    ambientIn: Range;
    /** Halo builds during the aura sweep and flares as the identity appears. */
    halo: { rise: Range; flare: number };
  };
  overlay: {
    header: Range;
    name: Range;
    /** Letters of the title are staggered so the whole word fits inside `window`. */
    title: { window: Range; letter: number; maxStagger: number };
    subtitle: Range;
    chips: { start: number; duration: number; stagger: number };
    footer: Range;
  };
  ambient: {
    wingPeriod: number;
    /** Maximum foreshortening of the wings, as a fraction of their width. */
    wingAmplitude: number;
    pulsePeriod: number;
    floatPeriod: number;
    floatAmplitude: number;
  };
}

export const timelineConfig: TimelineConfig = {
  duration: 6000,
  stillTime: 4200,
  phases: [
    { id: 'reveal', label: 'Reveal', range: [0, 1200] },
    { id: 'aura', label: 'Aura sweep', range: [1200, 2500] },
    { id: 'identity', label: 'Identity', range: [2500, 3500] },
    { id: 'ambient', label: 'Ambient loop', range: [3500, 6000] },
  ],
  scene: {
    atmosphere: [0, 900],
    converge: [0, 1150],
    reveal: [150, 1250],
    heroScale: [0, 1200],
    bloomPeak: 1150,
    ribbons: [1200, 2350],
    facets: { start: 1450, stagger: 110, rise: 260, settle: 750 },
    sweep: [1350, 2450],
    floatIn: [1200, 2600],
    ambientIn: [3300, 4600],
    halo: { rise: [1500, 2500], flare: 2850 },
  },
  overlay: {
    // The owner's logo is the first thing on screen.
    header: [100, 600],
    name: [2500, 2900],
    title: { window: [2600, 3250], letter: 480, maxStagger: 32 },
    subtitle: [2950, 3330],
    chips: { start: 3000, duration: 320, stagger: 90 },
    footer: [3150, 3500],
  },
  ambient: {
    wingPeriod: 4200,
    wingAmplitude: 0.05,
    pulsePeriod: 3000,
    floatPeriod: 6000,
    floatAmplitude: 3.5,
  },
};
