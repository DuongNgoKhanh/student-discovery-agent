import type { CardRatio } from './types';

/** Card design width in units. Every painter and overlay is authored in these units. */
export const CARD_WIDTH = 400;

export interface RatioLayout {
  ratio: CardRatio;
  height: number;
  /** Artwork square: top-left corner and side length, in card units. */
  art: { x: number; y: number; size: number };
  /** Bottom veil that keeps the identity block legible. */
  veil: { start: number; solid: number };
  /** Scales ribbons and particle convergence around the artwork. */
  heroScale: number;
  title: { max: number; min: number };
  /** Top of the brand header, and the space kept below the identity block. */
  header: { top: number };
  identity: { bottom: number };
  /**
   * Story-safe band (card units): platform UI (progress bar and avatar on top, reply bar at the
   * bottom) covers what lies outside it. Meta recommends ~14% clear at top and bottom of 9:16.
   */
  safe?: { top: number; bottom: number };
}

export const layouts: Record<CardRatio, RatioLayout> = {
  '9:16': {
    ratio: '9:16',
    height: 711,
    art: { x: -24, y: 56, size: 448 },
    veil: { start: 340, solid: 425 },
    heroScale: 1,
    title: { max: 46, min: 28 },
    // Deliberately above `safe.top`: the brand sits near the top edge (Story UI may overlap it).
    header: { top: 38 },
    identity: { bottom: 100 },
    safe: { top: 100, bottom: 611 },
  },
  '4:5': {
    ratio: '4:5',
    height: 500,
    art: { x: 32, y: 6, size: 336 },
    veil: { start: 250, solid: 316 },
    heroScale: 0.76,
    title: { max: 40, min: 26 },
    header: { top: 30 },
    identity: { bottom: 24 },
  },
};

export const exportSizes: Record<CardRatio, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '4:5': { width: 1080, height: 1350 },
};
