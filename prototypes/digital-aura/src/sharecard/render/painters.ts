import { beatGlow, facetGlow, haloGlow } from '../animation/timeline';
import { CARD_WIDTH } from '../layout';
import type { ArtworkAsset, RibbonSpec } from '../types';
import type { PreparedArtwork } from './artwork';
import { applyRevealMask, paintRevealEffect, type HeroGeometry } from './reveals';
import { glowSprite, heroCenter, mixStops, rgba, seeded, type FrameState } from './scene';

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ backdrop */

export function paintBackdrop(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const { layout, theme, sample } = frame;
  const { backdrop } = theme.palette;
  const h = layout.height;
  const c = heroCenter(frame);
  ctx.fillStyle = backdrop[2];
  ctx.fillRect(0, 0, CARD_WIDTH, h);
  ctx.globalAlpha = sample.atmosphere;
  const g = ctx.createRadialGradient(c.x, c.y - 30, 0, c.x, c.y - 30, h * 0.75);
  g.addColorStop(0, backdrop[0]);
  g.addColorStop(0.55, backdrop[1]);
  g.addColorStop(1, backdrop[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_WIDTH, h);
  // Two faint nebulae for depth; they drift a little with the pointer.
  ctx.globalCompositeOperation = 'lighter';
  const nebula = (x: number, y: number, r: number, color: string, a: number) => {
    const n = ctx.createRadialGradient(x, y, 0, x, y, r);
    n.addColorStop(0, rgba(color, a));
    n.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = n;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  const px = frame.pointer.x * 3;
  const py = frame.pointer.y * 3;
  nebula(70 + px, c.y - 150 + py, 190, theme.palette.accent, 0.14);
  nebula(340 + px, c.y + 40 + py, 170, theme.palette.blue, 0.1);
}

/* ----------------------------------------------------------------- particles */

export interface Particle {
  x: number;
  y: number;
  depth: number;
  size: number;
  phase: number;
  twinkle: number;
  color: string;
}

export function createParticles(count: number, height: number, colors: readonly string[]) {
  const rand = seeded(20261022);
  return Array.from({ length: count }, (): Particle => {
    const depth = rand() < 0.55 ? 0 : rand() < 0.7 ? 1 : 2;
    return {
      x: rand() * CARD_WIDTH,
      y: rand() * height,
      depth,
      size: (0.6 + rand() * 1.1) * (1 + depth * 0.45),
      phase: rand() * TAU,
      twinkle: 0.6 + rand() * 1.4,
      color: colors[Math.floor(rand() * colors.length)]!,
    };
  });
}

export interface Converger {
  angle: number;
  distance: number;
  tx: number;
  ty: number;
  delay: number;
  size: number;
  color: string;
}

export function createConvergers(count: number, colors: readonly string[]) {
  const rand = seeded(46);
  return Array.from({ length: count }, (): Converger => ({
    angle: rand() * TAU,
    distance: 190 + rand() * 170,
    tx: (rand() * 2 - 1) * 0.9,
    ty: (rand() * 2 - 1) * 0.75,
    delay: rand() * 0.35,
    size: 1 + rand() * 1.6,
    color: colors[Math.floor(rand() * colors.length)]!,
  }));
}

const DRIFT = [3, 6, 11]; // units per second, by depth
const PARALLAX = [2, 5, 11]; // units at full pointer deflection, by depth

export function paintParticles(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  particles: readonly Particle[],
) {
  const { sample, layout, pointer, theme } = frame;
  const h = layout.height + 20;
  const shape = theme.particleShape ?? 'glow';
  // Bubbles rise (like motes); petals fall.
  const dir = shape === 'petal' ? -1 : 1;
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    const drift = sample.clock * DRIFT[p.depth]! * dir;
    const y = ((((p.y - drift + pointer.y * PARALLAX[p.depth]!) % h) + h) % h) - 10;
    const sway = shape === 'glow' ? 2.5 : 6;
    const x = p.x + Math.sin(sample.clock * 0.35 + p.phase) * sway + pointer.x * PARALLAX[p.depth]!;
    const twinkle = 0.55 + 0.45 * Math.sin(sample.clock * p.twinkle + p.phase);
    const visible = p.depth === 2 ? sample.reveal : sample.atmosphere;
    const alpha = visible * twinkle * (0.35 + p.depth * 0.2);
    if (shape === 'glow' || p.depth === 0) {
      ctx.globalAlpha = alpha;
      const r = p.size * 3.2;
      ctx.drawImage(glowSprite(p.color), x - r, y - r, r * 2, r * 2);
    } else if (shape === 'bubble') {
      paintBubble(ctx, x, y, p.size * 3, p.color, alpha);
    } else {
      paintPetal(ctx, x, y, p.size, sample.clock * 0.7 + p.phase, p.color, alpha);
    }
  }
  ctx.globalAlpha = 1;
}

export function paintBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
) {
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rgba(color, Math.min(1, alpha * 1.4));
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = rgba('#ffffff', Math.min(1, alpha * 1.6));
  ctx.beginPath();
  ctx.arc(x - r * 0.38, y - r * 0.38, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
}

function paintPetal(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  color: string,
  alpha: number,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // Flutter: the petal turns edge-on and back as it falls.
  ctx.scale(1, 0.35 + 0.4 * Math.abs(Math.sin(angle * 1.7)));
  ctx.globalAlpha = 1;
  ctx.fillStyle = rgba(color, Math.min(1, alpha * 1.3));
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 3.6, size * 1.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function paintConvergers(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  convergers: readonly Converger[],
) {
  const { sample, layout } = frame;
  if (sample.converge >= 1 || sample.reduced) return;
  const c = heroCenter(frame);
  const k = layout.heroScale;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const at = (p: Converger, u: number) => {
    const swirl = p.angle + (1 - u) * 1.1;
    const sx = c.x + Math.cos(swirl) * p.distance * k;
    const sy = c.y + Math.sin(swirl) * p.distance * k;
    const tx = c.x + p.tx * 150 * k;
    const ty = c.y + p.ty * 105 * k;
    return { x: sx + (tx - sx) * u, y: sy + (ty - sy) * u };
  };
  for (const p of convergers) {
    const u = Math.max(0, Math.min(1, (sample.converge - p.delay) / (1 - p.delay)));
    if (u <= 0 || u >= 1) continue;
    const alpha = Math.min(1, Math.sin(u * Math.PI) * 1.4) * (1 - sample.reveal * 0.4);
    const head = at(p, u);
    const tail = at(p, Math.max(0, u - 0.14));
    ctx.globalAlpha = alpha * 0.8;
    ctx.strokeStyle = rgba(p.color, 1);
    ctx.lineWidth = p.size * 0.9;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    ctx.globalAlpha = alpha;
    const r = p.size * 6;
    ctx.drawImage(glowSprite(p.color), head.x - r, head.y - r, r * 2, r * 2);
  }
}

/* ------------------------------------------------------------------- ribbons */

const SEGMENTS = 70;

export function paintRibbons(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  part: 'back' | 'front',
) {
  const { sample, layout, theme, pointer } = frame;
  if (sample.ribbons <= 0) return;
  const k = layout.heroScale;
  const center = heroCenter(frame);
  const cx = center.x + pointer.x * 8;
  const cy = center.y + pointer.y * 6 + sample.float - 6 * k;
  const front = part === 'front';
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const spec of theme.ribbons)
    paintRibbon(ctx, spec, sample, cx, cy + (spec.offsetY ?? 0) * k, k, front);
}

function paintRibbon(
  ctx: CanvasRenderingContext2D,
  spec: RibbonSpec,
  sample: FrameState['sample'],
  cx: number,
  cy: number,
  k: number,
  front: boolean,
) {
  const dir = Math.sign(spec.speed) || 1;
  const head = spec.phase + spec.speed * sample.clock;
  const length = spec.length * sample.ribbons;
  const tilt = (spec.tilt * Math.PI) / 180;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const point = (theta: number) => {
    const lx = Math.cos(theta) * spec.rx * k;
    const ly = (Math.sin(theta) * spec.ry + Math.sin(theta * 3 + sample.clock * 1.3) * 4) * k;
    return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos, front: Math.sin(theta) > 0 };
  };

  // Faint full orbit, like the rings in the Figma design.
  ctx.globalAlpha = 0.16 * sample.ribbons;
  ctx.strokeStyle = rgba(spec.colors[1] ?? spec.colors[0]!, 1);
  ctx.lineWidth = 0.7 * k;
  ctx.beginPath();
  let drawing = false;
  for (let i = 0; i <= 96; i++) {
    const p = point((i / 96) * TAU);
    if (p.front !== front) {
      drawing = false;
      continue;
    }
    if (drawing) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
    drawing = true;
  }
  ctx.stroke();

  // Comet trail: bright iridescent head, tapering tail. Glow pass then core pass.
  const pts = Array.from({ length: SEGMENTS + 1 }, (_, i) =>
    point(head - dir * length * (i / SEGMENTS)),
  );
  for (const pass of [0, 1] as const) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (a.front !== front) continue;
      const u = i / SEGMENTS;
      const fade = (1 - u) ** 1.6 * sample.ribbons * (front ? 1 : 0.6);
      const width = spec.width * k * (1 - 0.72 * u);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = mixStops(spec.colors, u, pass === 0 ? fade * 0.17 : fade);
      ctx.lineWidth = pass === 0 ? width * 7 : width;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
}

/* ----------------------------------------------------------------- butterfly */

const scratch = new Map<string, HTMLCanvasElement>();

function scratchFor(target: HTMLCanvasElement | OffscreenCanvas) {
  const key = `${target.width}x${target.height}`;
  let c = scratch.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = target.width;
    c.height = target.height;
    scratch.set(key, c);
  }
  return c;
}

export function paintButterfly(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  art: PreparedArtwork,
  asset: ArtworkAsset,
) {
  const { sample, layout, pointer, theme } = frame;
  const { art: box } = layout;
  // Fit the artwork to the layout square (or its width, for portrait masters), preserving aspect.
  const byWidth = asset.fit === 'width';
  const fit = box.size / (byWidth ? art.width : Math.max(art.width, art.height));
  const w = art.width * fit;
  const h = art.height * fit;
  const x0 = box.x + (box.size - w) / 2;
  const y0 = byWidth ? box.y : box.y + (box.size - h) / 2;
  const fx = x0 + asset.focal.x * w;
  const fy = y0 + asset.focal.y * h;
  const revealStyle = theme.motion?.reveal ?? 'radial';
  const axis = asset.bodyAxis
    ? (() => {
        const [a, b] = asset.bodyAxis;
        const dx = (b.x - a.x) * w;
        const dy = (b.y - a.y) * h;
        return {
          x: x0 + a.x * w,
          y: y0 + a.y * h,
          angle: Math.atan2(dy, dx),
          length: Math.hypot(dx, dy),
        };
      })()
    : null;
  const geometry: HeroGeometry = {
    x0,
    y0,
    w,
    h,
    fx,
    fy,
    axis,
    halo: asset.halo
      ? { x: x0 + asset.halo.x * w, y: y0 + asset.halo.y * h, r: asset.halo.radius * w }
      : null,
  };

  // During the reveal the hero is composed off-screen and masked by the archetype's reveal.
  const revealing = sample.reveal < 0.999;
  const target = revealing ? scratchFor(ctx.canvas).getContext('2d')! : ctx;
  if (revealing) {
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalCompositeOperation = 'source-over';
    target.globalAlpha = 1;
    target.clearRect(0, 0, target.canvas.width, target.canvas.height);
    target.setTransform(ctx.getTransform());
  }

  target.save();
  target.translate(fx + pointer.x * 4, fy + pointer.y * 3 + sample.float);
  target.scale(sample.heroScale, sample.heroScale);
  target.translate(-fx, -fy);

  // Wings: foreshorten perpendicular to the body axis (= flat wings rotating about the body).
  // The `unfold` reveal starts with the wings nearly closed and opens them.
  const fold = revealStyle === 'unfold' && !sample.reduced ? (1 - sample.reveal) * 0.82 : 0;
  const squash = 1 - (1 - sample.wing) * (1 - fold);
  if (axis && squash > 0.0005) {
    target.translate(axis.x, axis.y);
    target.rotate(axis.angle);
    target.scale(1, 1 - squash);
    target.rotate(-axis.angle);
    target.translate(-axis.x, -axis.y);
  }

  // Halo behind, artwork, then a soft additive bloom on top.
  target.globalCompositeOperation = 'lighter';
  target.globalAlpha = Math.min(1, sample.bloom * 0.42);
  target.drawImage(art.bloom, x0 - w * 0.04, y0 - h * 0.04, w * 1.08, h * 1.08);
  target.globalCompositeOperation = 'source-over';
  target.globalAlpha = 1;
  target.drawImage(art.image, x0, y0, w, h);
  target.globalCompositeOperation = 'lighter';
  target.globalAlpha = Math.min(1, sample.bloom * 0.12);
  target.drawImage(art.bloom, x0, y0, w, h);

  // Crystal facets emit light.
  asset.facets.forEach((facet, i) => {
    const glow =
      facetGlow(sample, i) +
      (theme.rhythm ? beatGlow(sample, i, asset.facets.length, theme.rhythm.bpm) * 0.9 : 0);
    if (glow <= 0.01) return;
    const px = x0 + facet.x * w;
    const py = y0 + facet.y * h;
    const r = 30 * facet.size * (0.55 + glow * 0.6);
    target.globalAlpha = Math.min(1, glow * 0.7);
    target.drawImage(
      glowSprite(i % 2 ? theme.palette.accent : theme.palette.blue),
      px - r,
      py - r,
      r * 2,
      r * 2,
    );
    if (facet.size >= 0.6) paintFlare(target, px, py, 26 * facet.size * glow, glow);
  });
  if (asset.halo) {
    const { x, y, radius, rays = true } = asset.halo;
    paintHalo(target, frame, x0 + x * w, y0 + y * h, radius * w, rays);
  }
  if (asset.ripples) {
    const { x, y, rx, ry } = asset.ripples;
    paintRipples(target, frame, x0 + x * w, y0 + y * h, rx * w, ry * w);
  }
  const eye = asset.facets[0];
  if (theme.motion?.eyeScan && eye) paintEyeScan(target, frame, x0 + eye.x * w, y0 + eye.y * h);
  if (theme.rhythm) paintBeatRing(target, frame, fx, fy, theme.rhythm.bpm);
  target.restore();

  if (revealing) {
    applyRevealMask(target, revealStyle, frame, geometry);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Linear reveals carry their own edge; only the radial ones also fade in.
    const fadeIn = revealStyle === 'radial' || revealStyle === 'droplet';
    ctx.globalAlpha = fadeIn ? Math.min(1, sample.reveal * 1.6) : 1;
    ctx.drawImage(target.canvas, 0, 0);
    ctx.restore();
  }
  paintRevealEffect(ctx, revealStyle, frame, geometry);
}

const EYE_SCAN_PERIOD = 4500;

/** Decoder: every few seconds a thin light sweeps down across the eye. */
function paintEyeScan(ctx: CanvasRenderingContext2D, frame: FrameState, x: number, y: number) {
  const { sample, theme } = frame;
  if (sample.reduced || sample.ambient <= 0) return;
  const p = ((sample.t - 3600) % EYE_SCAN_PERIOD) / 700;
  if (p < 0 || p > 1) return;
  const ly = y - 22 + p * 44;
  const a = Math.sin(p * Math.PI) * 0.75 * sample.ambient;
  const g = ctx.createLinearGradient(x - 46, 0, x + 46, 0);
  g.addColorStop(0, rgba(theme.palette.blue, 0));
  g.addColorStop(0.5, rgba('#ffffff', a));
  g.addColorStop(1, rgba(theme.palette.blue, 0));
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(x - 46, ly - 0.7, 92, 1.4);
}

/** Rhythm Keeper: on the first beat of every bar, a ring spreads from the hero. */
function paintBeatRing(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  x: number,
  y: number,
  bpm: number,
) {
  const { sample, theme } = frame;
  if (sample.reduced || sample.ambient <= 0) return;
  const bar = (60000 / bpm) * 4;
  const p = (sample.t % bar) / (bar * 0.45);
  if (p > 1) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 1;
  ctx.strokeStyle = rgba(theme.palette.blue, (1 - p) * 0.5 * sample.ambient);
  ctx.lineWidth = 1.4 * (1 - p * 0.6);
  ctx.beginPath();
  ctx.ellipse(x, y, 40 + p * 190, (40 + p * 190) * 0.42, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/** Halo ring with a soft bloom and slowly turning rays. Drawn additively over the artwork. */
function paintHalo(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  x: number,
  y: number,
  r: number,
  rays: boolean,
) {
  const { sample, theme } = frame;
  // Storyteller: a gentle lantern flicker (two incommensurate waves).
  const flicker =
    theme.motion?.flicker && !sample.reduced
      ? 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(sample.t * 0.013) * Math.sin(sample.t * 0.0071 + 1))
      : 1;
  const a = haloGlow(sample) * flicker;
  if (a <= 0.01) return;
  const { blue, accent } = frame.theme.palette;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 1;
  // Soft disc of light behind the head, then a wide glow ring and a crisp core ring.
  const disc = ctx.createRadialGradient(x, y, 0, x, y, r * 1.25);
  disc.addColorStop(0, rgba(blue, 0.16 * a));
  disc.addColorStop(0.75, rgba(blue, 0.08 * a));
  disc.addColorStop(1, rgba(blue, 0));
  ctx.fillStyle = disc;
  ctx.fillRect(x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6);
  for (const [width, alpha, color] of [
    [r * 0.32, 0.14, blue],
    [r * 0.1, 0.38, blue],
    [r * 0.025, 0.9, '#f4fff9'],
  ] as const) {
    ctx.strokeStyle = rgba(color, Math.min(1, alpha * a));
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (!rays) return;
  // Rays alternate long and short and rotate very slowly.
  const turn = frame.sample.clock * 0.05;
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 36; i++) {
    const angle = turn + (i / 36) * Math.PI * 2;
    const inner = r * 1.08;
    const outer = r * (i % 2 ? 1.28 : 1.45);
    ctx.strokeStyle = rgba(i % 3 ? blue : accent, 0.3 * a);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
    ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
    ctx.stroke();
  }
}

const RIPPLE_PERIOD = 3.6; // seconds

/** Three concentric water rings spreading and fading, staggered evenly. */
function paintRipples(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  x: number,
  y: number,
  rx: number,
  ry: number,
) {
  const { sample, theme } = frame;
  const visible = Math.min(1, sample.reveal * 2.5);
  if (visible <= 0.01) return;
  const period = (theme.motion?.pulsePeriod ?? RIPPLE_PERIOD * 1000) / 1000;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 1;
  for (let i = 0; i < 3; i++) {
    const p = (sample.clock / period + i / 3) % 1;
    const alpha = (1 - p) * Math.min(1, p * 6) * 0.55 * visible;
    ctx.strokeStyle = rgba(i === 1 ? theme.palette.accent : theme.palette.blue, alpha);
    ctx.lineWidth = 1.2 * (1 - p * 0.5);
    ctx.beginPath();
    ctx.ellipse(x, y, rx * (0.25 + 0.75 * p), ry * (0.25 + 0.75 * p), 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.5 * visible;
  const r = rx * 0.45;
  ctx.drawImage(glowSprite(theme.palette.blue), x - r, y - r * 0.45, r * 2, r * 0.9);
}

function paintFlare(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, a: number) {
  ctx.globalAlpha = Math.min(1, a * 0.8);
  for (const [dx, dy, l] of [
    [1, 0, len],
    [0, 1, len * 1.25],
    [0.7, 0.7, len * 0.4],
    [0.7, -0.7, len * 0.4],
  ] as const) {
    const g = ctx.createLinearGradient(x - dx * l, y - dy * l, x + dx * l, y + dy * l);
    g.addColorStop(0, 'rgba(210,225,255,0)');
    g.addColorStop(0.5, 'rgba(240,246,255,0.95)');
    g.addColorStop(1, 'rgba(210,225,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(x - dx * l, y - dy * l);
    ctx.lineTo(x + dx * l, y + dy * l);
    ctx.stroke();
  }
}

/* -------------------------------------------------------------------- shards */

export function paintShards(
  ctx: CanvasRenderingContext2D,
  frame: FrameState,
  part: 'back' | 'front',
) {
  const { sample, layout, theme, pointer } = frame;
  const shards = theme.shards;
  if (!shards?.length || sample.ribbons <= 0) return;
  const k = layout.heroScale;
  const c = heroCenter(frame);
  const front = part === 'front';
  const parallax = front ? 12 : 5;
  const { blue, accent } = theme.palette;
  shards.forEach((shard, i) => {
    if ((shard.depth === 'front') !== front) return;
    // Staggered pop-in during the aura sweep.
    const local = Math.max(0, Math.min(1, sample.ribbons * 1.5 - i * 0.1));
    if (local <= 0) return;
    const bob = Math.sin(sample.clock * 0.9 + shard.phase) * 4;
    const x = c.x + shard.dx * k + pointer.x * parallax;
    const y = c.y + shard.dy * k + bob + pointer.y * parallax * 0.7 + sample.float * 0.5;
    const h = shard.size * k * (0.6 + 0.4 * local);
    const angle = shard.phase + shard.spin * sample.clock;
    const light = 0.45 + 0.55 * sample.pulse;

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = local * light * 0.45;
    const r = h * 2.6;
    ctx.drawImage(glowSprite(i % 2 ? accent : blue), x - r, y - r, r * 2, r * 2);

    // Octahedron seen from the side: spinning moves the front ridge and narrows the girdle.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((shard.tilt * Math.PI) / 180);
    const width = h * 0.62 * (0.55 + 0.45 * Math.abs(Math.cos(angle)));
    const ridge = Math.sin(angle) * width * 0.65;
    const girdle = -h * 0.18;
    const T = [0, -h] as const;
    const B = [0, h] as const;
    const L = [-width, girdle] as const;
    const R = [width, girdle] as const;
    const M = [ridge, girdle + h * 0.06] as const;
    const shade = (Math.sin(angle) + 1) / 2;
    const facet = (pts: readonly (readonly [number, number])[], fill: string) => {
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = local;
    facet([T, L, M], rgba('#ffffff', 0.3 + 0.25 * shade));
    facet([T, M, R], rgba(blue, 0.26 + 0.22 * (1 - shade)));
    facet([B, L, M], rgba(accent, 0.34 + 0.14 * shade));
    facet([B, M, R], rgba(blue, 0.2 + 0.16 * (1 - shade)));

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba('#eaf6ff', 0.55 + 0.35 * light);
    ctx.lineWidth = 1.1;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(...T);
    ctx.lineTo(...L);
    ctx.lineTo(...B);
    ctx.lineTo(...R);
    ctx.closePath();
    ctx.moveTo(...T);
    ctx.lineTo(...M);
    ctx.lineTo(...B);
    ctx.moveTo(...L);
    ctx.lineTo(...M);
    ctx.lineTo(...R);
    ctx.stroke();
    ctx.globalAlpha = local * light;
    const s = h * 0.5;
    ctx.drawImage(glowSprite('#ffffff'), T[0] - s / 2 + ridge * 0.3, T[1] + h * 0.25 - s / 2, s, s);
    ctx.restore();
  });
}

/* -------------------------------------------------------------------- chrome */

/** Legibility veils, holographic sheen, the aura sweep and the inset frame. */
export function paintChrome(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const { layout, theme, sample, pointer } = frame;
  const h = layout.height;
  const { veil } = theme.palette;

  const bottom = ctx.createLinearGradient(0, layout.veil.start, 0, layout.veil.solid);
  bottom.addColorStop(0, rgba(veil, 0));
  bottom.addColorStop(0.6, rgba(veil, 0.78));
  bottom.addColorStop(1, rgba(veil, 0.96));
  ctx.fillStyle = bottom;
  ctx.fillRect(0, layout.veil.start, CARD_WIDTH, h - layout.veil.start);

  // Keeps the brand header legible wherever it sits (lower in the Story-safe 9:16 layout).
  const headerEnd = layout.header.top + 86;
  const top = ctx.createLinearGradient(0, 0, 0, headerEnd);
  top.addColorStop(0, rgba(veil, 0.72));
  top.addColorStop((layout.header.top + 44) / headerEnd, rgba(veil, 0.5));
  top.addColorStop(1, rgba(veil, 0));
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, CARD_WIDTH, headerEnd);

  // Holographic sheen that follows the pointer (static when the pointer is at rest).
  ctx.globalCompositeOperation = 'screen';
  const sx = CARD_WIDTH * (0.5 + pointer.x * 0.45);
  const sy = h * (0.35 + pointer.y * 0.3);
  const sheen = ctx.createLinearGradient(sx - 260, sy - 260, sx + 260, sy + 260);
  sheen.addColorStop(0, rgba(theme.palette.blue, 0));
  sheen.addColorStop(0.42, rgba(theme.palette.blue, 0.05));
  sheen.addColorStop(0.5, rgba('#ffffff', 0.07 * sample.atmosphere));
  sheen.addColorStop(0.58, rgba(theme.palette.accent, 0.05));
  sheen.addColorStop(1, rgba(theme.palette.accent, 0));
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, CARD_WIDTH, h);

  // Aura sweep: a single diagonal band of light crossing the card in phase 2.
  if (sample.sweep !== null) {
    ctx.globalCompositeOperation = 'lighter';
    const d = -200 + sample.sweep * (CARD_WIDTH + h + 400);
    const band = ctx.createLinearGradient(d - 90, d * 0.35 - 90, d + 90, d * 0.35 + 90);
    const a = Math.sin(sample.sweep * Math.PI) * 0.16;
    band.addColorStop(0, rgba(theme.palette.blue, 0));
    band.addColorStop(0.5, rgba('#e6e9ff', a));
    band.addColorStop(1, rgba(theme.palette.accent, 0));
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, CARD_WIDTH, h);
  }

  // Inset hairline frame: the only decorative border.
  ctx.globalCompositeOperation = 'source-over';
  const frameGrad = ctx.createLinearGradient(0, 0, CARD_WIDTH, h);
  theme.palette.frame.forEach((color, i, all) =>
    frameGrad.addColorStop(i / (all.length - 1), rgba(color, 0.5)),
  );
  ctx.globalAlpha = sample.atmosphere;
  ctx.strokeStyle = frameGrad;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(12, 12, CARD_WIDTH - 24, h - 24, 18);
  ctx.stroke();
}
