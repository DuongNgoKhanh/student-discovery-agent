import type { SceneSample } from '../animation/timeline';
import type { RatioLayout } from '../layout';
import type { ArchetypeTheme } from '../types';

/** Everything a painter needs for one frame. Painters are pure functions of this state. */
export interface FrameState {
  sample: SceneSample;
  layout: RatioLayout;
  theme: ArchetypeTheme;
  /** Smoothed pointer position, -1..1 on each axis; 0,0 at rest. */
  pointer: { x: number; y: number };
}

export interface SceneLayer {
  z: number;
  paint(ctx: CanvasRenderingContext2D, frame: FrameState): void;
}

/** Paint order. Ribbons straddle the butterfly so they visibly orbit it. */
export const Z = {
  backdrop: 0,
  farParticles: 10,
  ribbonsBack: 20,
  shardsBack: 25,
  hero: 30,
  ribbonsFront: 40,
  shardsFront: 45,
  nearParticles: 50,
  chrome: 60,
} as const;

/** Artwork focal point in card units. */
export function heroCenter({ layout, theme }: Pick<FrameState, 'layout' | 'theme'>) {
  const { art } = layout;
  return {
    x: art.x + theme.artwork.focal.x * art.size,
    y: art.y + theme.artwork.focal.y * art.size,
  };
}

/**
 * A normalised artwork point in card units, using the same fit as the hero painter. Relies on
 * `artwork.aspect` (default square), so it works before the image is decoded.
 */
export function artToCard(
  { layout, theme }: Pick<FrameState, 'layout' | 'theme'>,
  p: { x: number; y: number },
) {
  const { art: box } = layout;
  const asset = theme.artwork;
  const aspect = asset.aspect ?? 1;
  let w: number;
  let h: number;
  if (asset.fit === 'width' || aspect < 1) {
    w = box.size;
    h = w * aspect;
  } else {
    h = box.size;
    w = h / aspect;
  }
  const x0 = box.x + (box.size - w) / 2;
  const y0 = asset.fit === 'width' ? box.y : box.y + (box.size - h) / 2;
  return { x: x0 + p.x * w, y: y0 + p.y * h, w, h, x0, y0 };
}

/**
 * Paint every layer into `ctx`. `unit` is device pixels per card unit; layers draw in
 * card units and must leave the context state as they found it.
 */
export function paintScene(
  ctx: CanvasRenderingContext2D,
  layers: readonly SceneLayer[],
  frame: FrameState,
  unit: number,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const layer of [...layers].sort((a, b) => a.z - b.z)) {
    ctx.save();
    ctx.setTransform(unit, 0, 0, unit, 0, 0);
    layer.paint(ctx, frame);
    ctx.restore();
  }
}

const rgbCache = new Map<string, [number, number, number]>();

/** `#rrggbb` → rgba() string. Parsed colours are cached; painters call this per segment. */
export function rgba(hex: string, alpha: number) {
  let rgb = rgbCache.get(hex);
  if (!rgb) {
    const n = Number.parseInt(hex.slice(1), 16);
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, rgb);
  }
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;
}

/** Colour at position `u` (0..1) along a list of hex stops. */
export function mixStops(stops: readonly string[], u: number, alpha: number) {
  const scaled = Math.min(0.9999, Math.max(0, u)) * (stops.length - 1);
  const i = Math.floor(scaled);
  const f = scaled - i;
  const a = stops[i]!;
  const b = stops[i + 1] ?? a;
  rgba(a, 1);
  rgba(b, 1);
  const ca = rgbCache.get(a)!;
  const cb = rgbCache.get(b)!;
  const ch = (k: 0 | 1 | 2) => Math.round(ca[k] + (cb[k] - ca[k]) * f);
  return `rgba(${ch(0)},${ch(1)},${ch(2)},${alpha.toFixed(3)})`;
}

const sprites = new Map<string, HTMLCanvasElement>();

/** Soft round glow sprite, rendered once per colour and drawn scaled with `lighter`. */
export function glowSprite(color: string) {
  let sprite = sprites.get(color);
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = sprite.height = 64;
  const ctx = sprite.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, rgba('#ffffff', 1));
  g.addColorStop(0.18, rgba(color, 0.9));
  g.addColorStop(0.45, rgba(color, 0.28));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  sprites.set(color, sprite);
  return sprite;
}

/** Deterministic PRNG so particle fields are identical in preview and export. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
