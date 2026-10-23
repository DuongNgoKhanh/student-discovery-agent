import {
  overlayStyle,
  scrambleGlyph,
  type OverlayTrack,
  type TitleStyle,
} from '../animation/timeline';

/**
 * Export-time replay of the DOM overlay. The live card lays out its typography with real
 * CSS; for export we measure that layout once and repaint it on canvas each frame with the
 * same timeline styles. Elements opt in with `data-paint="text" | "box" | "svg" | "img"`; the nearest
 * `data-track` ancestor supplies their animation.
 */

interface Animated {
  track: OverlayTrack | null;
  index: number;
  count: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Centre of the tracked ancestor: the origin for scale/rotate, as in CSS. */
  ox: number;
  oy: number;
}

interface TextNode extends Animated {
  kind: 'text';
  text: string;
  font: string;
  color: string;
  letterSpacing: number;
  shadow: { color: string; blur: number } | null;
}

interface BoxNode extends Animated {
  kind: 'box';
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
}

interface ImageNode extends Animated {
  kind: 'image';
  image: HTMLImageElement;
}

export type OverlayNode = TextNode | BoxNode | ImageNode;

/** Layout offset of `el` inside `root`, ignoring CSS transforms (scale, tilt, motion). */
function offsetWithin(el: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

export async function collectOverlay(root: HTMLElement): Promise<OverlayNode[]> {
  const nodes: OverlayNode[] = [];
  const images: Promise<unknown>[] = [];
  root.querySelectorAll<HTMLElement>('[data-paint]').forEach((el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const tracked = el.closest<HTMLElement>('[data-track]');
    const { x, y } = offsetWithin(el, root);
    const origin = tracked ? offsetWithin(tracked, root) : { x, y };
    const base: Animated = {
      track: (tracked?.dataset.track as OverlayTrack | undefined) ?? null,
      index: Number(tracked?.dataset.index ?? 0),
      count: Number(tracked?.dataset.count ?? 1),
      x,
      y,
      w: el.offsetWidth,
      h: el.offsetHeight,
      ox: origin.x + (tracked?.offsetWidth ?? el.offsetWidth) / 2,
      oy: origin.y + (tracked?.offsetHeight ?? el.offsetHeight) / 2,
    };
    if (el.dataset.paint === 'img' && el instanceof HTMLImageElement) {
      const node: ImageNode = { ...base, kind: 'image', image: el };
      images.push(el.decode().catch(() => undefined));
      nodes.push(node);
      return;
    }
    if (el.dataset.paint === 'svg') {
      const svg = el.querySelector('svg');
      if (!svg) return;
      const node: ImageNode = { ...base, kind: 'image', image: new Image() };
      images.push(rasterizeSvg(svg, style.color, node));
      nodes.push(node);
      return;
    }
    if (el.dataset.paint === 'box') {
      nodes.push({
        ...base,
        kind: 'box',
        fill: style.backgroundColor,
        stroke: style.borderTopColor,
        strokeWidth: Number.parseFloat(style.borderTopWidth) || 0,
        radius: Number.parseFloat(style.borderTopLeftRadius) || 0,
      });
      return;
    }
    const raw = el.textContent ?? '';
    nodes.push({
      ...base,
      kind: 'text',
      text: style.textTransform === 'uppercase' ? raw.toLocaleUpperCase('vi') : raw,
      font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
      color: style.color,
      letterSpacing: Number.parseFloat(style.letterSpacing) || 0,
      shadow: parseShadow(style.textShadow),
    });
  });
  await Promise.all(images);
  return nodes;
}

/** Inline icon → image with `currentColor` resolved, oversampled so it stays crisp at 1080 px. */
async function rasterizeSvg(svg: SVGSVGElement, color: string, node: ImageNode) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('color', color);
  clone.setAttribute('width', String(node.w * 4));
  clone.setAttribute('height', String(node.h * 4));
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }),
  );
  try {
    node.image.src = url;
    await node.image.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** First shadow of a computed `text-shadow`, e.g. "rgb(183, 124, 255) 0px 0px 18px". */
function parseShadow(value: string) {
  if (!value || value === 'none') return null;
  const color = value.match(/rgba?\([^)]*\)/)?.[0];
  const lengths = value.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g);
  if (!color || !lengths || lengths.length < 3) return null;
  return { color, blur: Number.parseFloat(lengths[2]!) };
}

const supportsLetterSpacing =
  typeof CanvasRenderingContext2D !== 'undefined' &&
  'letterSpacing' in CanvasRenderingContext2D.prototype;
const supportsFilter =
  typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;

export function paintOverlay(
  ctx: CanvasRenderingContext2D,
  nodes: readonly OverlayNode[],
  time: number,
  reduced = false,
  titleStyle: TitleStyle = 'blur',
) {
  // shadowBlur and filter lengths ignore the transform, so scale them to device pixels.
  const k = Math.hypot(ctx.getTransform().a, ctx.getTransform().b);
  for (const node of nodes) {
    if (!node.track) {
      drawNode(ctx, node, k, null);
      continue;
    }
    const style = overlayStyle(node.track, time, reduced, node.index, node.count, titleStyle);
    if (style.opacity <= 0.002) continue;
    ctx.save();
    ctx.globalAlpha = style.opacity;
    ctx.translate(style.x, style.y);
    if (style.scale !== 1 || style.rotate !== 0) {
      ctx.translate(node.ox, node.oy);
      ctx.rotate((style.rotate * Math.PI) / 180);
      ctx.scale(style.scale, style.scale);
      ctx.translate(-node.ox, -node.oy);
    }
    if (supportsFilter && style.blur > 0.05) ctx.filter = `blur(${(style.blur * k).toFixed(2)}px)`;
    const glyph =
      titleStyle === 'scramble' &&
      node.track === 'title' &&
      node.kind === 'text' &&
      node.text.trim()
        ? scrambleGlyph(time, node.index, node.count, reduced)
        : null;
    drawNode(ctx, node, k, glyph);
    ctx.restore();
  }
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: OverlayNode,
  k: number,
  glyph: string | null,
) {
  if (node.kind === 'image') ctx.drawImage(node.image, node.x, node.y, node.w, node.h);
  else if (node.kind === 'box') paintBox(ctx, node);
  else if (glyph) paintText(ctx, { ...node, text: glyph, letterSpacing: 0 }, k, true);
  else paintText(ctx, node, k);
}

function paintBox(ctx: CanvasRenderingContext2D, node: BoxNode) {
  const inset = node.strokeWidth / 2;
  ctx.beginPath();
  ctx.roundRect(
    node.x + inset,
    node.y + inset,
    node.w - inset * 2,
    node.h - inset * 2,
    node.radius,
  );
  ctx.fillStyle = node.fill;
  ctx.fill();
  if (node.strokeWidth > 0) {
    ctx.strokeStyle = node.stroke;
    ctx.lineWidth = node.strokeWidth;
    ctx.stroke();
  }
}

function paintText(ctx: CanvasRenderingContext2D, node: TextNode, k: number, centred = false) {
  ctx.font = node.font;
  ctx.fillStyle = node.color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = centred ? 'center' : 'left';
  const m = ctx.measureText('Hg');
  const ascent = m.fontBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent;
  // CSS centres the font's ascent+descent inside the line box (half-leading).
  const baseline = node.y + (node.h - (ascent + descent)) / 2 + ascent;
  if (node.shadow) {
    ctx.shadowColor = node.shadow.color;
    ctx.shadowBlur = node.shadow.blur * k;
  }
  if (supportsLetterSpacing) {
    ctx.letterSpacing = `${node.letterSpacing}px`;
    ctx.fillText(node.text, centred ? node.x + node.w / 2 : node.x, baseline);
    return;
  }
  let x = node.x;
  for (const ch of node.text) {
    ctx.fillText(ch, x, baseline);
    x += ctx.measureText(ch).width + node.letterSpacing;
  }
}
