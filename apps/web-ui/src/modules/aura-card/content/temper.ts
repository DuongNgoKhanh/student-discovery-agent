import type { ArchetypeTheme, ArchetypeCopy } from '../types';

// Served from public/aura/: canvas painters load the artwork from a plain URL.
const otterUrl = '/aura/temper.webp';
const otter45Url = '/aura/temper-45.webp';

export const temperContent: ArchetypeCopy = {
  archetype: {
    id: 'temper',
    title: 'Người Giữ Nhịp',
    subtitle: 'The Rhythm Keeper',
  },
  strengths: [{ label: 'Cảm nhận nhịp' }, { label: 'Hòa hợp' }, { label: 'Nhất quán' }],
  tagline: 'Giữ nhịp giúp ta kết nối với chính mình và những người xung quanh',
  fields: ['Công nghệ', 'Khoa học', 'Nghiên cứu'],
};

export const temperTheme: ArchetypeTheme = {
  id: 'temper',
  artwork: {
    src: otterUrl,
    alt: 'Rái cá vươn mình giữa dòng nước xoáy, bọt nước và tinh thể xanh ngọc',
    provenance: 'Digital Aura otter master (1254×1254), served as WebP.',
    // Full-bleed 9:16 master (941×1672): fitted to the card, as for creator.
    aspect: 711 / 400,
    fit: 'fill',
    box: { x: 0, y: 0, size: 400 },
    focal: { x: 0.6, y: 0.37 },
    bodyAxis: [
      { x: 0.659, y: 0.251 },
      { x: 0.446, y: 0.478 },
    ],
    facets: [
      { x: 0.627, y: 0.269, size: 0.6 }, // eye
      { x: 0.17, y: 0.179, size: 0.65 }, // upper-left crystal
      { x: 0.818, y: 0.144, size: 0.7 }, // upper-right crystal
      { x: 0.903, y: 0.383, size: 0.65 }, // right crystal
      { x: 0.213, y: 0.478, size: 0.8 }, // large left crystal
      { x: 0.34, y: 0.574, size: 0.55 }, // centre crystal
      { x: 0.159, y: 0.281, size: 0.6 }, // left orb
      { x: 0.893, y: 0.496, size: 0.6 }, // right orb
      { x: 0.159, y: 0.849, size: 0.5 }, // bottom-left orb
    ],
    erase: [],
    feather: { top: 0.05, bottom: 0.2, side: 0.04 },
  },
  // Dark block under the identity text, as for creator.
  // Off: the identity text sits on its own dark zones (name, chips, footer).
  veil: { start: 711, solid: 711 },
  // Soft dark pool behind the identity text, so it stays legible over the bright artwork.
  panel: { y: 560, rx: 260, ry: 175, alpha: 0.8 },
  identity: { bottom: 50 },
  header: { top: 40, inset: 55, labelInset: 40 },
  // 4:5 card (400×500) uses the -45 master, with its own points and no baked-in frame.
  landscape: {
    artwork: {
      src: otter45Url,
      aspect: 1,
      box: { x: 23, y: -20, size: 340 },
      fit: 'width',
      focal: { x: 0.52, y: 0.45 },
      bodyAxis: [
        { x: 0.51, y: 0.2 },
        { x: 0.45, y: 0.55 },
      ],
      facets: [
        { x: 0.526, y: 0.191, size: 0.6 }, // eye
        { x: 0.136, y: 0.08, size: 0.65 }, // upper-left crystal
        { x: 0.586, y: 0.076, size: 0.5 }, // top crystal
        { x: 0.829, y: 0.136, size: 0.7 }, // upper-right crystal
        { x: 0.104, y: 0.399, size: 0.6 }, // left crystal
        { x: 0.391, y: 0.606, size: 0.65 }, // centre crystal
        { x: 0.742, y: 0.79, size: 0.75 }, // lower-right crystal
        { x: 0.534, y: 0.774, size: 0.45 }, // bubble
        { x: 0.199, y: 0.813, size: 0.45 }, // lower-left bubble
      ],
    },
    veil: { start: 250, solid: 320 },
    identity: { bottom: 22 },
    header: { top: 26, inset: 28, labelInset: 28 },
  },
  palette: {
    backdrop: ['#1d5868', '#0b2530', '#04121a'],
    veil: '#06161d',
    accent: '#8ef3ff',
    lavender: '#d2f7ff',
    blue: '#5fe1ff',
    text: '#f2fdff',
    muted: '#a3c6cf',
    chip: 'rgba(20, 86, 104, 0.5)',
    chipBorder: 'rgba(140, 235, 255, 0.75)',
    frame: ['#d8fbff', '#5fe1ff', '#a8f0ff', '#3cc6e6'],
    particles: ['#f0fdff', '#9eefff', '#c8f6ff'],
    glow: '#1aa9c9',
  },
  ribbons: [
    {
      rx: 200,
      ry: 64,
      tilt: -18,
      colors: ['#ffffff', '#bff6ff', '#5fe1ff', '#2bb7d9'],
      width: 3,
      speed: 0.6,
      phase: 0.4,
      length: 3.6,
      offsetY: 90,
    },
    {
      rx: 170,
      ry: 52,
      tilt: 20,
      colors: ['#f2fdff', '#8ef3ff', '#3cc6e6'],
      width: 2,
      speed: -0.5,
      phase: 3.4,
      length: 2.8,
      offsetY: 130,
    },
  ],
  shards: [
    { dx: -190, dy: -80, size: 18, depth: 'back', spin: 0.5, tilt: -10, phase: 1.1 },
    { dx: 175, dy: 40, size: 18, depth: 'front', spin: -0.45, tilt: 12, phase: 3.7 },
  ],
  particleShape: 'bubble',
  rhythm: { bpm: 80 },
  // Droplet: a drop falls and the wave ring opens the image; type lands on the beat.
  motion: { intro: 'bubbles', aura: 'waves', reveal: 'droplet', title: 'beat' },
};
