import type { ArtworkAsset } from '../types';

export interface PreparedArtwork {
  /** Masked artwork: feathered edges, baked-in text erased. */
  image: HTMLCanvasElement;
  /** Heavily downsampled copy, drawn upscaled as cheap bloom (works without ctx.filter). */
  bloom: HTMLCanvasElement;
  width: number;
  height: number;
}

const MAX_SIDE = 2048;
const cache = new Map<string, Promise<PreparedArtwork>>();

export function prepareArtwork(asset: ArtworkAsset): Promise<PreparedArtwork> {
  const key = `${asset.src}|${JSON.stringify(asset.erase)}|${JSON.stringify(asset.feather)}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = load(asset);
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

async function load(asset: ArtworkAsset): Promise<PreparedArtwork> {
  const img = new Image();
  img.decoding = 'async';
  img.src = asset.src;
  await img.decode();
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);

  const image = canvas(width, height);
  const ctx = image.getContext('2d')!;
  ctx.drawImage(img, 0, 0, width, height);
  ctx.globalCompositeOperation = 'destination-out';

  // Erase baked-in corner text: solid core, feathered rim.
  for (const e of asset.erase) {
    ctx.save();
    ctx.translate(e.cx * width, e.cy * height);
    ctx.scale(e.rx * width, e.ry * height);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.72, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }

  // Feather all four edges so the square never reads as a pasted photo.
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  };
  const { top, bottom, side } = asset.feather;
  if (top > 0) edge(0, 0, 0, top * height);
  if (bottom > 0) edge(0, height, 0, height * (1 - bottom));
  if (side > 0) {
    edge(0, 0, side * width, 0);
    edge(width, 0, width * (1 - side), 0);
  }

  // Two-step downsample gives a smooth blur in every browser.
  const mid = canvas(Math.max(8, width >> 2), Math.max(8, height >> 2));
  mid.getContext('2d')!.drawImage(image, 0, 0, mid.width, mid.height);
  const bloom = canvas(Math.max(4, width >> 4), Math.max(4, height >> 4));
  bloom.getContext('2d')!.drawImage(mid, 0, 0, bloom.width, bloom.height);

  return { image, bloom, width, height };
}

function canvas(width: number, height: number) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}
