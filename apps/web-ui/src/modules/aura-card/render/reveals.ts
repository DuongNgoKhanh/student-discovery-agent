import { CARD_WIDTH } from '../layout';
import type { RevealStyle } from '../types';
import { glowSprite, rgba, seeded, type FrameState } from './scene';

/**
 * Phase-1 reveal styles. Each style is a mask (what part of the hero is visible) plus an
 * optional light effect drawn over the card while the reveal runs. Everything is in card
 * units and is a pure function of the frame, so preview and export match.
 */

/** Where the hero sits this frame, in card units. */
export interface HeroGeometry {
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Focal point. */
  fx: number;
  fy: number;
  /** Body axis start and angle, when the artwork defines one. */
  axis: { x: number; y: number; angle: number; length: number } | null;
  /** Halo centre and radius, when the artwork defines one (the sun for `dawn`). */
  halo: { x: number; y: number; r: number } | null;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const smooth = (n: number) => {
  const c = clamp01(n);
  return c * c * (3 - 2 * c);
};

const masks = new Map<string, HTMLCanvasElement>();
function maskCanvasFor(target: HTMLCanvasElement | OffscreenCanvas) {
  const key = `${target.width}x${target.height}`;
  let c = masks.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = target.width;
    c.height = target.height;
    masks.set(key, c);
  }
  return c;
}

/** Bottom of the visible hero (portrait art can extend past the card). */
const heroBottom = (g: HeroGeometry, frame: FrameState) =>
  Math.min(g.y0 + g.h, frame.layout.height);

/**
 * Restrict `target` (holding the composed hero) to the revealed area. `target` must carry the
 * card-unit base transform. The last 15% of every reveal fades to fully opaque, so whatever the
 * shape, handing over to the unmasked frame never pops.
 */
export function applyRevealMask(
  target: CanvasRenderingContext2D,
  style: RevealStyle,
  frame: FrameState,
  g: HeroGeometry,
) {
  const r = frame.sample.reveal;
  const mask = maskCanvasFor(target.canvas).getContext('2d')!;
  mask.setTransform(1, 0, 0, 1, 0, 0);
  mask.globalCompositeOperation = 'source-over';
  mask.globalAlpha = 1;
  mask.clearRect(0, 0, mask.canvas.width, mask.canvas.height);
  mask.setTransform(target.getTransform());
  const H = frame.layout.height;

  switch (style) {
    case 'unfold': {
      // A band that widens perpendicular to the body axis.
      const a = g.axis ?? { x: g.fx, y: g.fy, angle: Math.PI / 2, length: g.h };
      const half = Math.max(1, r * g.w * 0.75);
      mask.save();
      mask.translate(a.x, a.y);
      mask.rotate(a.angle);
      const band = mask.createLinearGradient(0, -half, 0, half);
      band.addColorStop(0, 'rgba(0,0,0,0)');
      band.addColorStop(0.3, 'rgba(0,0,0,1)');
      band.addColorStop(0.7, 'rgba(0,0,0,1)');
      band.addColorStop(1, 'rgba(0,0,0,0)');
      mask.fillStyle = band;
      mask.fillRect(-H * 2, -half, H * 4, half * 2);
      mask.restore();
      break;
    }
    case 'scan': {
      const y = scanLine(r, g, frame);
      const grad = mask.createLinearGradient(0, y - 50, 0, y);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      mask.fillStyle = grad;
      mask.fillRect(0, 0, CARD_WIDTH, y);
      break;
    }
    case 'rise': {
      fillRise(mask, riseLine(r, g, frame));
      break;
    }
    case 'dawn': {
      const sun = g.halo ?? { x: g.fx, y: g.fy, r: g.w * 0.15 };
      const sr = Math.max(1, smooth(r / 0.45) * sun.r * 2.6);
      const disc = mask.createRadialGradient(sun.x, sun.y, sr * 0.4, sun.x, sun.y, sr);
      disc.addColorStop(0, 'rgba(0,0,0,1)');
      disc.addColorStop(1, 'rgba(0,0,0,0)');
      mask.fillStyle = disc;
      mask.fillRect(0, 0, CARD_WIDTH, H);
      fillRise(mask, riseLine(clamp01((r - 0.25) / 0.75), g, frame));
      break;
    }
    case 'ink': {
      for (const blot of inkBlots()) {
        const p = clamp01((r - blot.threshold) / 0.3);
        if (p <= 0) continue;
        const x = g.x0 + blot.u * g.w;
        const y = g.y0 + blot.v * g.h;
        const radius = blot.size * g.w * (0.35 + 0.65 * p);
        const ink = mask.createRadialGradient(x, y, radius * 0.55, x, y, radius);
        ink.addColorStop(0, 'rgba(0,0,0,1)');
        ink.addColorStop(1, 'rgba(0,0,0,0)');
        mask.fillStyle = ink;
        mask.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      break;
    }
    default: {
      // radial and droplet: a circle opening from the focal point (droplet has a crisper edge).
      const radius = Math.max(1, r * (g.w + g.h) * 0.48);
      const inner = style === 'droplet' ? 0.82 : 0.45;
      const disc = mask.createRadialGradient(g.fx, g.fy, radius * inner, g.fx, g.fy, radius);
      disc.addColorStop(0, 'rgba(0,0,0,1)');
      disc.addColorStop(1, 'rgba(0,0,0,0)');
      mask.fillStyle = disc;
      mask.fillRect(0, 0, CARD_WIDTH, H);
    }
  }

  const tail = smooth((r - 0.85) / 0.15);
  if (tail > 0) {
    mask.globalAlpha = tail;
    mask.fillStyle = '#000';
    mask.fillRect(0, 0, CARD_WIDTH, H);
  }

  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalCompositeOperation = 'destination-in';
  target.drawImage(mask.canvas, 0, 0);
  target.restore();
}

/** Light that accompanies each reveal, drawn additively over the card in card units. */
export function paintRevealEffect(
  ctx: CanvasRenderingContext2D,
  style: RevealStyle,
  frame: FrameState,
  g: HeroGeometry,
) {
  const { sample, theme } = frame;
  const r = sample.reveal;
  if (sample.reduced || r >= 0.999) return;
  const fade = 1 - smooth((r - 0.7) / 0.3);
  const { blue, accent } = theme.palette;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  switch (style) {
    case 'unfold': {
      // The seam along the body glows as the wings open.
      if (!g.axis) break;
      ctx.translate(g.axis.x, g.axis.y);
      ctx.rotate(g.axis.angle);
      const seam = ctx.createLinearGradient(-g.axis.length * 0.2, 0, g.axis.length * 1.2, 0);
      seam.addColorStop(0, rgba(accent, 0));
      seam.addColorStop(0.5, rgba('#ffffff', 0.85 * fade));
      seam.addColorStop(1, rgba(accent, 0));
      ctx.strokeStyle = seam;
      ctx.lineWidth = 2 + 10 * (1 - r);
      ctx.beginPath();
      ctx.moveTo(-g.axis.length * 0.2, 0);
      ctx.lineTo(g.axis.length * 1.2, 0);
      ctx.stroke();
      break;
    }
    case 'scan': {
      const y = scanLine(r, g, frame);
      // Decoding grid just ahead of the line.
      ctx.lineWidth = 0.5;
      for (let gy = Math.floor(y / 22) * 22; gy < y + 150; gy += 22) {
        const a = (1 - (gy - y) / 150) * 0.22 * fade;
        if (a <= 0) continue;
        ctx.strokeStyle = rgba(blue, a);
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(CARD_WIDTH, gy);
        ctx.stroke();
      }
      for (let gx = 11; gx < CARD_WIDTH; gx += 22) {
        const col = ctx.createLinearGradient(0, y, 0, y + 150);
        col.addColorStop(0, rgba(blue, 0.18 * fade));
        col.addColorStop(1, rgba(blue, 0));
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.lineTo(gx, y + 150);
        ctx.stroke();
      }
      // The scanline itself, with a soft band.
      const band = ctx.createLinearGradient(0, y - 16, 0, y + 16);
      band.addColorStop(0, rgba(blue, 0));
      band.addColorStop(0.5, rgba(blue, 0.35 * fade));
      band.addColorStop(1, rgba(blue, 0));
      ctx.fillStyle = band;
      ctx.fillRect(0, y - 16, CARD_WIDTH, 32);
      ctx.fillStyle = rgba('#ffffff', 0.9 * fade);
      ctx.fillRect(0, y - 0.6, CARD_WIDTH, 1.2);
      break;
    }
    case 'rise':
    case 'dawn': {
      const p = style === 'dawn' ? clamp01((r - 0.25) / 0.75) : r;
      const y = riseLine(p, g, frame);
      const color = style === 'dawn' ? accent : blue;
      const band = ctx.createLinearGradient(0, y - 30, 0, y + 30);
      band.addColorStop(0, rgba(color, 0));
      band.addColorStop(0.5, rgba(color, 0.45 * fade * Math.min(1, p * 4)));
      band.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = band;
      ctx.fillRect(0, y - 30, CARD_WIDTH, 60);
      if (style === 'dawn' && g.halo) {
        const s = g.halo.r * 3.2;
        ctx.globalAlpha = 0.7 * fade;
        ctx.drawImage(glowSprite(accent), g.halo.x - s, g.halo.y - s, s * 2, s * 2);
      }
      break;
    }
    case 'droplet': {
      // A droplet falls to the focal point, then wave rings run ahead of the opening.
      const fall = clamp01(sample.t / 420);
      if (fall < 1) {
        const y = -20 + (g.fy + 20) * fall * fall;
        const s = 7;
        ctx.globalAlpha = 0.95;
        ctx.drawImage(glowSprite('#ffffff'), g.fx - s, y - s * 1.6, s * 2, s * 3.2);
      }
      const radius = r * (g.w + g.h) * 0.48;
      for (const [k, a] of [
        [1, 0.55],
        [0.86, 0.3],
        [0.7, 0.18],
      ] as const) {
        ctx.strokeStyle = rgba(k === 1 ? '#ffffff' : blue, a * fade);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(g.fx, g.fy, Math.max(0.1, radius * k), 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'ink': {
      // Embers glow along the spreading edge.
      for (const blot of inkBlots()) {
        const p = clamp01((r - blot.threshold) / 0.3);
        if (p <= 0 || p >= 1) continue;
        const x = g.x0 + blot.u * g.w;
        const y = g.y0 + blot.v * g.h;
        const s = blot.size * g.w * (0.35 + 0.65 * p) * 0.9;
        ctx.globalAlpha = Math.sin(p * Math.PI) * 0.4 * fade;
        ctx.drawImage(glowSprite('#ff9a5c'), x - s, y - s, s * 2, s * 2);
      }
      break;
    }
  }
  ctx.restore();
}

function scanLine(r: number, g: HeroGeometry, frame: FrameState) {
  const top = g.y0 - 40;
  return top + r * (heroBottom(g, frame) + 60 - top);
}

function riseLine(r: number, g: HeroGeometry, frame: FrameState) {
  const bottom = heroBottom(g, frame) + 20;
  return bottom - r * (bottom - g.y0 + 60);
}

function fillRise(mask: CanvasRenderingContext2D, y: number) {
  const grad = mask.createLinearGradient(0, y, 0, y + 60);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,1)');
  mask.fillStyle = grad;
  mask.fillRect(0, y, CARD_WIDTH, 4000);
}

let blots: { u: number; v: number; size: number; threshold: number }[] | null = null;

/** Ink blots across the artwork; left ones start first, with a little randomness. */
function inkBlots() {
  if (!blots) {
    const rand = seeded(7331);
    blots = Array.from({ length: 72 }, () => {
      const u = rand() * 1.1 - 0.05;
      return {
        u,
        v: rand() * 1.1 - 0.05,
        size: 0.12 + rand() * 0.12,
        threshold: u * 0.6 + rand() * 0.2,
      };
    });
  }
  return blots;
}
