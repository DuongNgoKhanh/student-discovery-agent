import { CARD_WIDTH } from '../layout';
import type { AuraStyle, IntroStyle } from '../types';
import { paintBubble } from './painters';
import {
  artToCard,
  glowSprite,
  heroCenter,
  mixStops,
  rgba,
  seeded,
  type FrameState,
} from './scene';

/**
 * Per-archetype motifs that replace the shared opening convergence (`paintIntro`) and the
 * shared orbiting ribbons (`paintAura`). All pure functions of the frame, in card units, drawn
 * additively in front of the artwork (the artwork is opaque, so "behind" parts are drawn dimmer
 * rather than hidden).
 */

const TAU = Math.PI * 2;
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const smooth = (n: number) => {
  const c = clamp01(n);
  return c * c * (3 - 2 * c);
};

/** Seeded particle lists, built once per style. */
const lists = new Map<string, unknown>();
function list<T>(key: string, count: number, make: (rand: () => number, i: number) => T): T[] {
  let l = lists.get(key) as T[] | undefined;
  if (!l) {
    const rand = seeded(key.length * 7919 + count);
    l = Array.from({ length: count }, (_, i) => make(rand, i));
    lists.set(key, l);
  }
  return l;
}

const trailColors = (frame: FrameState) =>
  frame.theme.ribbons[0]?.colors ?? [frame.theme.palette.blue, frame.theme.palette.accent];

interface TrailPoint {
  x: number;
  y: number;
  /** 1 = near, lower = far. */
  depth?: number;
}

/** Tapered comet trail: index 0 is the bright head. Glow pass, then core pass. */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  pts: readonly TrailPoint[],
  colors: readonly string[],
  width: number,
  alpha: number,
  taper = 0.72,
) {
  const n = pts.length - 1;
  if (n < 1 || alpha <= 0.01) return;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  for (const pass of [0, 1] as const) {
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const u = i / n;
      const fade = (1 - u) ** 1.6 * alpha * (a.depth ?? 1);
      const w = width * (1 - taper * u);
      ctx.strokeStyle = mixStops(colors, u, pass === 0 ? fade * 0.16 : fade * 0.95);
      ctx.lineWidth = pass === 0 ? w * 6 : w;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
}

/* ===================================================================== intros */

/** Envelope for opening effects: fade in quickly, fade out as the reveal completes. */
const introEnvelope = (frame: FrameState, outFrom = 0.55) =>
  smooth(frame.sample.t / 220) * (1 - smooth((frame.sample.reveal - outFrom) / (1 - outFrom)));

export function paintIntro(ctx: CanvasRenderingContext2D, frame: FrameState, style: IntroStyle) {
  if (frame.sample.reduced || frame.sample.t > 2600) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  switch (style) {
    case 'pollen':
      pollen(ctx, frame);
      break;
    case 'datarain':
      dataRain(ctx, frame);
      break;
    case 'fireflies':
      fireflies(ctx, frame);
      break;
    case 'sunrays':
      sunRays(ctx, frame);
      break;
    case 'bubbles':
      bubbleBursts(ctx, frame);
      break;
    case 'embers':
      embers(ctx, frame);
      break;
    case 'converge':
      break; // handled by paintConvergers
  }
  ctx.restore();
}

/** Lemniscate of Bernoulli: a horizontal figure-eight, like a pair of wings. */
const lemniscate = (theta: number) => {
  const d = 1 + Math.sin(theta) ** 2;
  return { x: Math.cos(theta) / d, y: (Math.sin(theta) * Math.cos(theta)) / d };
};

function pollen(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const { sample, layout, theme } = frame;
  const c = heroCenter(frame);
  const env = introEnvelope(frame);
  if (env <= 0) return;
  const spread = 0.1 + 0.9 * (1 - sample.converge);
  const motes = list('pollen', 52, (rand, i) => ({
    phase: rand() * TAU,
    speed: 1.5 + rand() * 1.3,
    lane: 0.7 + rand() * 0.55,
    size: 0.8 + rand() * 1.3,
    color: theme.palette.particles[i % theme.palette.particles.length]!,
  }));
  ctx.lineCap = 'round';
  for (const m of motes) {
    const a = 190 * layout.heroScale * spread * m.lane;
    const at = (dt: number) => {
      const p = lemniscate(m.phase + (sample.clock - dt) * m.speed);
      return { x: c.x + p.x * a, y: c.y + p.y * a * 1.1 };
    };
    const head = at(0);
    const tail = at(0.09);
    ctx.globalAlpha = env * 0.55;
    ctx.strokeStyle = rgba(m.color, 1);
    ctx.lineWidth = m.size * 0.8;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    ctx.globalAlpha = env;
    const r = m.size * 5;
    ctx.drawImage(glowSprite(m.color), head.x - r, head.y - r, r * 2, r * 2);
  }
}

function dataRain(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const { sample, layout, theme } = frame;
  const env = introEnvelope(frame, 0.45);
  if (env <= 0) return;
  const H = layout.height;
  const columns = list('datarain', 24, (rand) => ({
    speed: 240 + rand() * 200,
    offset: rand() * (H + 120),
    length: 5 + Math.floor(rand() * 6),
  }));
  ctx.font = '600 10px Inter, ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tick = Math.floor(sample.t / 90);
  columns.forEach((col, i) => {
    const x = 10 + i * ((CARD_WIDTH - 20) / (columns.length - 1));
    const head = ((sample.clock * col.speed + col.offset) % (H + 120)) - 60;
    for (let j = 0; j < col.length; j++) {
      const y = head - j * 12;
      if (y < -10 || y > H + 10) continue;
      const bit = (Math.imul(tick + j * 7, 2654435761) ^ Math.imul(i + 1, 40503)) & 1;
      const a = env * (1 - j / col.length) * (j === 0 ? 1 : 0.6);
      ctx.fillStyle = rgba(j === 0 ? '#ffffff' : theme.palette.blue, a);
      ctx.fillText(bit ? '1' : '0', x, y);
    }
  });
}

function fireflies(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const { sample, layout, theme } = frame;
  const env = smooth(sample.t / 200) * (1 - smooth((sample.t - 1700) / 800));
  if (env <= 0) return;
  const c = heroCenter(frame);
  const water = theme.artwork.ripples
    ? artToCard(frame, theme.artwork.ripples).y
    : layout.veil.start;
  const motes = list('fireflies', 40, (rand, i) => ({
    x: (rand() * 2 - 1) * 160,
    delay: rand() * 650,
    rise: 170 + rand() * 230,
    phase: rand() * TAU,
    size: 0.9 + rand() * 1.4,
    gold: i % 3 === 0,
  }));
  for (const m of motes) {
    const p = clamp01((sample.t - m.delay) / 1500);
    if (p <= 0 || p >= 1) continue;
    const eased = 1 - (1 - p) ** 2;
    const x = c.x + m.x * layout.heroScale + Math.sin(sample.t * 0.0025 + m.phase) * 14 * p;
    const y = water - eased * m.rise * layout.heroScale;
    const twinkle = 0.6 + 0.4 * Math.sin(sample.t * 0.012 + m.phase);
    ctx.globalAlpha = Math.sin(p * Math.PI) * env * twinkle;
    const r = m.size * 5;
    const color = m.gold ? theme.palette.accent : theme.palette.blue;
    ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
  }
}

function sunRays(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const { sample, theme } = frame;
  const env = smooth(sample.t / 150) * (1 - smooth((sample.reveal - 0.6) / 0.4));
  if (env <= 0) return;
  const halo = theme.artwork.halo;
  const sun = halo ? artToCard(frame, halo) : { ...heroCenter(frame), w: 300 };
  const sunR = halo ? halo.radius * sun.w : 40;
  const rays = list('sunrays', 30, (rand) => ({
    angle: rand() * TAU,
    delay: rand() * 0.45,
    distance: 300 + rand() * 140,
    width: 0.8 + rand() * 1.4,
  }));
  ctx.lineCap = 'round';
  for (const ray of rays) {
    const u = clamp01((sample.converge - ray.delay) / (1 - ray.delay));
    if (u <= 0 || u >= 1) continue;
    const e = u * u;
    const inner = sunR * 0.5 + (1 - e) * ray.distance;
    const outer = inner + 18 + 46 * (1 - e);
    const cos = Math.cos(ray.angle);
    const sin = Math.sin(ray.angle);
    const g = ctx.createLinearGradient(
      sun.x + cos * outer,
      sun.y + sin * outer,
      sun.x + cos * inner,
      sun.y + sin * inner,
    );
    g.addColorStop(0, rgba(theme.palette.accent, 0));
    g.addColorStop(1, rgba('#fff6dc', 0.9 * env));
    ctx.strokeStyle = g;
    ctx.lineWidth = ray.width;
    ctx.beginPath();
    ctx.moveTo(sun.x + cos * outer, sun.y + sin * outer);
    ctx.lineTo(sun.x + cos * inner, sun.y + sin * inner);
    ctx.stroke();
  }
}

function bubbleBursts(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const { sample, layout, theme } = frame;
  const env = 1 - smooth((sample.reveal - 0.6) / 0.4);
  if (env <= 0) return;
  const c = heroCenter(frame);
  const H = layout.height;
  const eighth = 60000 / 80 / 2;
  const bubbles = list('bubbles', 46, (rand, i) => ({
    x: (rand() * 2 - 1) * 175,
    burst: i % 3,
    speed: 280 + rand() * 200,
    phase: rand() * TAU,
    size: 1.4 + rand() * 2.6,
    color: theme.palette.particles[i % theme.palette.particles.length]!,
  }));
  for (const b of bubbles) {
    const age = (sample.t - b.burst * eighth) / 1000;
    if (age < 0) continue;
    const y = H + 10 - age * b.speed;
    if (y < c.y - 170) continue;
    const x = c.x + b.x * layout.heroScale + Math.sin(age * 6 + b.phase) * 6;
    const fadeTop = clamp01((y - (c.y - 170)) / 80);
    paintBubble(ctx, x, y, b.size * 2.2, b.color, 0.75 * env * fadeTop);
  }
}

function embers(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const { sample } = frame;
  const top = artToCard(frame, { x: 0, y: 0 });
  const embersList = list('embers', 54, (rand, i) => ({
    birth: 120 + rand() * 1150,
    life: 900 + rand() * 600,
    v: rand() * 0.8 + 0.1,
    vx: 18 + rand() * 45,
    vy: -(35 + rand() * 70),
    size: 0.7 + rand() * 1.2,
    hot: i % 3 !== 0,
  }));
  ctx.lineCap = 'round';
  for (const e of embersList) {
    const age = (sample.t - e.birth) / e.life;
    if (age <= 0 || age >= 1) continue;
    // Born at the ink front, which sweeps left to right during the reveal.
    const front = clamp01((e.birth - 150) / 1100) * 0.95;
    const sx = top.x0 + front * top.w;
    const sy = top.y0 + e.v * Math.min(top.h, frame.layout.height - top.y0);
    const t = (age * e.life) / 1000;
    const x = sx + e.vx * t;
    const y = sy + e.vy * t;
    const flicker = 0.6 + 0.4 * Math.sin(sample.t * 0.03 + e.birth);
    const a = (1 - age) ** 1.4 * flicker;
    const color = e.hot ? '#ffb07a' : frame.theme.palette.accent;
    ctx.globalAlpha = a * 0.7;
    ctx.strokeStyle = rgba(color, 1);
    ctx.lineWidth = e.size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - e.vx * 0.07, y - e.vy * 0.07);
    ctx.stroke();
    ctx.globalAlpha = a;
    const r = e.size * 4;
    ctx.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
  }
}

/* ====================================================================== auras */

export function paintAura(ctx: CanvasRenderingContext2D, frame: FrameState, style: AuraStyle) {
  if (frame.sample.ribbons <= 0) return;
  ctx.save();
  switch (style) {
    case 'flight':
      flight(ctx, frame);
      break;
    case 'cipher':
      cipher(ctx, frame);
      break;
    case 'helix':
      helix(ctx, frame);
      break;
    case 'path':
      lightPath(ctx, frame);
      break;
    case 'waves':
      soundWaves(ctx, frame);
      break;
    case 'threads':
      threads(ctx, frame);
      break;
    case 'orbit':
      break; // handled by paintRibbons
  }
  ctx.restore();
}

/** Two comet trails flying figure-eights: one beneath the wings, one small loop above. */
function flight(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const { sample, layout, pointer } = frame;
  const k = layout.heroScale;
  const c = heroCenter(frame);
  const colors = trailColors(frame);
  const flights = [
    { dy: 135, a: 215, squash: 0.55, speed: 0.75, phase: 0.3, length: 2.4, width: 3 },
    { dy: -150, a: 120, squash: 0.5, speed: -0.95, phase: 2.6, length: 1.8, width: 1.9 },
  ];
  for (const f of flights) {
    const cx = c.x + pointer.x * 8;
    const cy = c.y + f.dy * k + pointer.y * 6 + sample.float;
    const head = f.phase + f.speed * sample.clock;
    const dir = Math.sign(f.speed);
    const pts = Array.from({ length: 61 }, (_, i) => {
      const theta = head - dir * f.length * sample.ribbons * (i / 60);
      const p = lemniscate(theta);
      return {
        x: cx + p.x * f.a * k,
        y: cy + p.y * f.a * f.squash * k * 2,
        depth: 0.55 + 0.45 * Math.abs(Math.cos(theta)),
      };
    });
    // Sparkle dust rather than a ribbon: the artworks already paint ribbons of their own.
    drawTrail(ctx, pts, colors, 0.8 * k, 0.45 * sample.ribbons, 0.5);
    pts.forEach((p, i) => {
      if (i % 2) return;
      const u = i / 60;
      const twinkle = 0.55 + 0.45 * Math.sin(sample.clock * 9 + i * 1.7);
      ctx.globalAlpha = (1 - u) ** 1.2 * twinkle * p.depth * sample.ribbons;
      const r = (i === 0 ? 10 : f.width * 2.2 * (1 - u * 0.6)) * k;
      const color = i === 0 ? '#ffffff' : (colors[1 + (i % 2)] ?? colors[0]!);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowSprite(color), p.x - r, p.y - r, r * 2, r * 2);
      // Solid core with a faint dark rim, so the dust reads even over bright wings.
      const core = Math.max(1.1, r * 0.22);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = rgba(frame.theme.palette.veil, 0.35);
      ctx.beginPath();
      ctx.arc(p.x, p.y, core + 0.9, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.95);
      ctx.beginPath();
      ctx.arc(p.x, p.y, core, 0, TAU);
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
  }
}

/** Dashed rings counter-rotating around the head, a sweeping highlight and rotating hex labels. */
function cipher(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const { sample, layout, theme, pointer } = frame;
  const k = layout.heroScale;
  const c = heroCenter(frame);
  const cx = c.x + pointer.x * 6;
  const cy = c.y + pointer.y * 5 + sample.float;
  const draw = sample.ribbons;
  const { blue } = theme.palette;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  const ring = (
    r: number,
    rot: number,
    span: number,
    dash: number[],
    width: number,
    alpha: number,
  ) => {
    ctx.setLineDash(dash.map((d) => d * k));
    ctx.strokeStyle = rgba(blue, alpha * draw);
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(cx, cy, r * k, rot, rot + span * draw);
    ctx.stroke();
  };
  ring(122, sample.clock * 0.35, TAU, [1.5, 7], 1.7, 0.9);
  for (let q = 0; q < 4; q++) {
    ring(152, -sample.clock * 0.22 + q * (TAU / 4), TAU / 4 - 0.5, [], 1.8, 0.8);
  }
  ring(186, sample.clock * 0.12, TAU * 0.72, [14, 5, 3, 5], 1.2, 0.7);
  ctx.setLineDash([]);

  // Tick marks on the outer ring.
  ctx.strokeStyle = rgba(blue, 0.6 * draw);
  ctx.lineWidth = 1;
  for (let i = 0; i < 48 * draw; i++) {
    const a = sample.clock * 0.12 + (i / 48) * TAU;
    const r0 = 192 * k;
    const r1 = (i % 4 === 0 ? 202 : 197) * k;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }

  // A bright segment sweeping the middle ring.
  const sweep = sample.clock * 1.4;
  const g = ctx.createConicGradient?.(sweep - 0.6, cx, cy);
  if (g) {
    g.addColorStop(0, rgba('#ffffff', 0));
    g.addColorStop(0.09, rgba('#ffffff', 0.85 * draw));
    g.addColorStop(0.1, rgba('#ffffff', 0));
    g.addColorStop(1, rgba('#ffffff', 0));
    ctx.strokeStyle = g;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 152 * k, 0, TAU);
    ctx.stroke();
  }

  // Rotating hex labels on the outer ring.
  ctx.font = '600 7.5px Inter, ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ['0x3F', 'A7·1', '0110', 'C·42'].forEach((label, i) => {
    const a = -sample.clock * 0.12 + i * (TAU / 4) + 0.4;
    const r = 172 * k;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillStyle = rgba('#e6f6ff', 0.9 * draw);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  });
}

/** A double helix rising from the water to the halo, with light flowing upward along it. */
function helix(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const { sample, layout, theme, pointer } = frame;
  const k = layout.heroScale;
  const c = heroCenter(frame);
  const art = theme.artwork;
  const bottom = art.ripples ? artToCard(frame, art.ripples).y : c.y + 150 * k;
  const top = art.halo ? artToCard(frame, art.halo).y : c.y - 160 * k;
  const colors = trailColors(frame);
  const visible = sample.ribbons;
  const N = 90;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const strand of [0, Math.PI]) {
    let prev: { x: number; y: number } | null = null;
    for (let i = 0; i <= N; i++) {
      const s = (i / N) * visible;
      const theta = TAU * 1.6 * s - sample.clock * 0.7 + strand;
      const radius = 125 * k * (1 - 0.4 * s);
      const x = c.x + pointer.x * 6 + Math.sin(theta) * radius;
      const y = bottom - s * (bottom - top) + pointer.y * 4;
      if (prev) {
        // Beads of light (like rising droplets) on a hairline, not a ribbon.
        const near = Math.cos(theta) > 0;
        const flow = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(TAU * (s * 2.2 - sample.clock * 0.4))) ** 2;
        const a = flow * (near ? 1 : 0.35) * (1 - s * 0.3);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = mixStops(colors, s, a * 0.4);
        ctx.lineWidth = 0.7 * k;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        if (i % 3 === 0) {
          const r = (5.5 - 2.5 * s) * k * (near ? 1 : 0.6);
          ctx.globalAlpha = Math.min(1, a * 1.2);
          ctx.drawImage(
            glowSprite(i % 6 ? '#ffffff' : theme.palette.accent),
            x - r,
            y - r,
            r * 2,
            r * 2,
          );
        }
      }
      prev = { x, y };
    }
  }
}

/** A road of light winding from the foreground to the sun, with sparks travelling along it. */
function lightPath(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const { sample, layout, theme, pointer } = frame;
  const k = layout.heroScale;
  const c = heroCenter(frame);
  const halo = theme.artwork.halo;
  const sun = halo ? artToCard(frame, halo) : { ...c, w: 300 };
  const r = halo ? halo.radius * sun.w : 40;
  // Foreground (bottom right) → sweeps left → climbs to the sun's lower-left rim, passing the
  // hero rather than crossing its head.
  const p0 = { x: c.x + 120 * k + pointer.x * 10, y: layout.veil.start - 5 };
  const p1 = { x: p0.x - 300 * k, y: p0.y - 25 * k };
  const p2 = { x: sun.x - r * 2.1, y: sun.y + r * 1.1 };
  const p3 = { x: sun.x - r * 0.8, y: sun.y + r * 0.6 };
  const at = (s: number) => {
    const m = 1 - s;
    return {
      x: m ** 3 * p0.x + 3 * m * m * s * p1.x + 3 * m * s * s * p2.x + s ** 3 * p3.x,
      y: m ** 3 * p0.y + 3 * m * m * s * p1.y + 3 * m * s * s * p2.y + s ** 3 * p3.y,
    };
  };
  const width = (s: number) => (10 * (1 - s) + 1.2) * k;
  const visible = sample.ribbons;
  const { accent } = theme.palette;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const N = 80;
  let prev = at(0);
  for (let i = 1; i <= N * visible; i++) {
    const s = i / N;
    const p = at(s);
    // A soft shadow under the light keeps it legible on near-white parts of the painting.
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = rgba(theme.palette.veil, 0.2);
    ctx.lineWidth = width(s) * 1.6 + 5 * k;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(accent, 0.1);
    ctx.lineWidth = width(s) * 2.6;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.strokeStyle = rgba('#fff3d6', 0.45 + 0.35 * s);
    ctx.lineWidth = Math.max(0.9, width(s) * 0.45);
    ctx.stroke();
    prev = p;
  }

  // Sparks walk the road toward the sun.
  for (let j = 0; j < 7; j++) {
    const s = (sample.clock * 0.16 + j / 7) % 1;
    if (s > visible) continue;
    const p = at(s);
    const size = width(s) * 1.4 + 4 * k;
    ctx.globalAlpha = 0.85 * (1 - s * 0.4);
    ctx.drawImage(glowSprite('#fff3d6'), p.x - size, p.y - size, size * 2, size * 2);
  }
}

/** Three sound-wave ribbons across the card that swell on every beat. */
function soundWaves(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const { sample, layout, theme, pointer } = frame;
  const k = layout.heroScale;
  const c = heroCenter(frame);
  const bpm = theme.rhythm?.bpm ?? 80;
  const beat = 60000 / bpm;
  const pulse = sample.reduced ? 0 : Math.exp(-((sample.t % beat) / beat) * 3.5) * sample.ambient;
  const colors = trailColors(frame);
  const waves = [
    { dy: 95, amp: 15, wave: 150, speed: 1.6, phase: 0, width: 2.2 },
    { dy: 125, amp: 10, wave: 115, speed: 2.3, phase: 1.7, width: 1.5 },
    { dy: 150, amp: 7, wave: 90, speed: 1.1, phase: 3.1, width: 1 },
  ];
  const reach = sample.ribbons * 0.5;
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const w of waves) {
    const baseY = c.y + w.dy * k + pointer.y * 5;
    const amp = w.amp * k * (0.6 + 0.6 * pulse);
    let prev: { x: number; y: number } | null = null;
    for (let i = 0; i <= 100; i++) {
      const xn = i / 100;
      if (Math.abs(xn - 0.5) > reach) {
        prev = null;
        continue;
      }
      const bell = Math.sin(Math.PI * xn) ** 1.2;
      const x = xn * CARD_WIDTH + pointer.x * 4;
      const y =
        baseY + Math.sin((x / w.wave) * TAU - sample.clock * w.speed + w.phase) * amp * bell;
      if (prev) {
        // Crisp oscilloscope lines, distinct from the painted water ribbons.
        const a = bell;
        ctx.globalAlpha = 1;
        ctx.strokeStyle = mixStops(colors, xn, a * 0.18);
        ctx.lineWidth = w.width * k * 5;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.strokeStyle = rgba('#ffffff', a * 0.85);
        ctx.lineWidth = Math.max(0.8, w.width * k * 0.6);
        ctx.stroke();
      }
      prev = { x, y };
    }
    // A bright dot riding each wave.
    const xd = (sample.clock * 0.12 + w.phase / TAU) % 1;
    if (Math.abs(xd - 0.5) <= reach) {
      const bell = Math.sin(Math.PI * xd) ** 1.2;
      const x = xd * CARD_WIDTH + pointer.x * 4;
      const y =
        baseY + Math.sin((x / w.wave) * TAU - sample.clock * w.speed + w.phase) * amp * bell;
      const r = 7 * k;
      ctx.globalAlpha = bell;
      ctx.drawImage(glowSprite('#ffffff'), x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
    }
  }
}

const THREADS = [
  [
    [-175, 55],
    [-60, -130],
    [125, 150],
    [195, -35],
  ],
  [
    [-160, -165],
    [20, -60],
    [-45, 115],
    [175, 125],
  ],
  [
    [185, -175],
    [55, -45],
    [165, 95],
    [-165, 150],
  ],
] as const;
const THREAD_CYCLE = 4800;

/** Calligraphic strokes that write themselves on, hold, then lift off; mirrored every other pass. */
function threads(ctx: CanvasRenderingContext2D, frame: FrameState) {
  const { sample, layout, pointer } = frame;
  const k = layout.heroScale;
  const c = heroCenter(frame);
  const colors = trailColors(frame);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  THREADS.forEach((curve, n) => {
    const elapsed = sample.t - 1200 - n * (THREAD_CYCLE / 3);
    if (elapsed < 0) return;
    const cycle = Math.floor(elapsed / THREAD_CYCLE);
    const local = (elapsed % THREAD_CYCLE) / THREAD_CYCLE;
    const headS = smooth(local / 0.38);
    const tailS = smooth((local - 0.58) / 0.38);
    if (headS - tailS < 0.005) return;
    const mirror = cycle % 2 === 1 ? -1 : 1;
    const pts = curve.map(([x, y]) => ({
      x: c.x + mirror * x * k + pointer.x * 7,
      y: c.y + y * k + pointer.y * 5 + sample.float,
    }));
    const at = (s: number) => {
      const m = 1 - s;
      const [a, b, d, e] = pts as unknown as [
        (typeof pts)[0],
        (typeof pts)[0],
        (typeof pts)[0],
        (typeof pts)[0],
      ];
      return {
        x: m ** 3 * a.x + 3 * m * m * s * b.x + 3 * m * s * s * d.x + s ** 3 * e.x,
        y: m ** 3 * a.y + 3 * m * m * s * b.y + 3 * m * s * s * d.y + s ** 3 * e.y,
      };
    };
    const N = 70;
    let prev = at(tailS);
    for (let i = 1; i <= N; i++) {
      const s = tailS + (headS - tailS) * (i / N);
      const p = at(s);
      // Brush pressure: thick mid-stroke, fine at both ends.
      const w = (0.8 + 3.2 * Math.sin(Math.PI * s)) * k;
      const nearHead = 1 - (headS - s) / Math.max(0.001, headS - tailS);
      const a = 0.55 + 0.45 * nearHead;
      ctx.strokeStyle = mixStops(colors, s, a * 0.14);
      ctx.lineWidth = w * 5;
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.strokeStyle = mixStops(colors, s, a * 0.9);
      ctx.lineWidth = w;
      ctx.stroke();
      prev = p;
    }
    // The pen tip glows while writing.
    if (local < 0.4) {
      const tip = at(headS);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(glowSprite('#ffffff'), tip.x - 7, tip.y - 7, 14, 14);
      ctx.globalAlpha = 1;
    }
  });
}
