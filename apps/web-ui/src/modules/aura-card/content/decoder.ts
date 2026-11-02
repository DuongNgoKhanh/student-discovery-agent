import type { ArchetypeTheme, ArchetypeCopy } from '../types';

// Served from public/aura/: canvas painters load the artwork from a plain URL.
const lynxUrl = '/aura/decoder.webp';
const decoder45Url = '/aura/decoder-45.webp';

export const decoderContent: ArchetypeCopy = {
  archetype: {
    id: 'decoder',
    title: 'Người Giải Mã',
    subtitle: 'The Decoder',
  },
  strengths: [{ label: 'Logic' }, { label: 'Tò mò' }, { label: 'Chính xác' }],
  tagline: 'Luôn tìm kiếm quy luật đằng sau những điều phức tạp',
  fields: ['Công nghệ', 'Khoa học', 'Nghiên cứu'],
};

export const decoderTheme: ArchetypeTheme = {
  id: 'decoder',
  artwork: {
    src: lynxUrl,
    alt: 'Linh miêu trắng mắt xanh phát sáng giữa vầng sáng tinh thể',
    provenance: 'Digital Aura lynx master (1254×1254), served as WebP.',
    // Full-bleed 9:16 master (941×1672): fitted to the card, as for creator.
    aspect: 711 / 400,
    fit: 'fill',
    box: { x: 0, y: 0, size: 400 },
    focal: { x: 0.55, y: 0.42 },
    bodyAxis: [
      { x: 0.595, y: 0.383 },
      { x: 0.457, y: 0.598 },
    ],
    facets: [
      { x: 0.648, y: 0.326, size: 0.75 }, // eye
      { x: 0.866, y: 0.299, size: 0.7 }, // right crystal
      { x: 0.244, y: 0.568, size: 0.75 }, // left crystal
      { x: 0.175, y: 0.161, size: 0.55 }, // upper-left crystal
      { x: 0.893, y: 0.502, size: 0.5 }, // right bubble
      { x: 0.505, y: 0.102, size: 0.6 }, // apex star
      { x: 0.808, y: 0.819, size: 0.6 }, // lower-right crystal
      { x: 0.159, y: 0.275, size: 0.45 }, // left bubble
    ],
    erase: [],
    feather: { top: 0.06, bottom: 0.22, side: 0.05 },
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
      src: decoder45Url,
      aspect: 1,
      box: { x: 23, y: -20, size: 340 },
      fit: 'width',
      focal: { x: 0.55, y: 0.45 },
      bodyAxis: [
        { x: 0.51, y: 0.335 },
        { x: 0.415, y: 0.798 },
      ],
      facets: [
        { x: 0.55, y: 0.399, size: 0.75 }, // eye
        { x: 0.837, y: 0.542, size: 0.7 }, // right crystal
        { x: 0.223, y: 0.734, size: 0.75 }, // left crystal
        { x: 0.171, y: 0.167, size: 0.55 }, // upper-left crystal
        { x: 0.837, y: 0.271, size: 0.45 }, // upper-right crystal
        { x: 0.343, y: 0.798, size: 0.45 }, // bubble
        { x: 0.805, y: 0.407, size: 0.45 }, // right bubble
        { x: 0.51, y: 0.072, size: 0.5 }, // apex star
      ],
    },
    veil: { start: 250, solid: 320 },
    identity: { bottom: 22 },
    header: { top: 26, inset: 28, labelInset: 28 },
  },
  palette: {
    backdrop: ['#38488c', '#151a40', '#080b22'],
    veil: '#0a0d27',
    accent: '#8fa6ff',
    lavender: '#cfdaff',
    blue: '#8fe3ff',
    text: '#f6f9ff',
    muted: '#aab4d8',
    chip: 'rgba(58, 72, 152, 0.5)',
    chipBorder: 'rgba(150, 192, 255, 0.75)',
    frame: ['#e0ecff', '#7f9cff', '#8fe3ff', '#b8a6ff'],
    particles: ['#eef6ff', '#a9c4ff', '#9fe8ff'],
    glow: '#4f6dff',
  },
  ribbons: [
    {
      rx: 205,
      ry: 70,
      tilt: -24,
      colors: ['#ffffff', '#a8e6ff', '#7f9cff', '#c4a8ff'],
      width: 3.2,
      speed: 0.55,
      phase: 0.6,
      length: 3.6,
      offsetY: 120,
    },
    {
      rx: 175,
      ry: 58,
      tilt: 16,
      colors: ['#f4fbff', '#8fd8ff', '#9a8cff'],
      width: 2.2,
      speed: -0.42,
      phase: 3.1,
      length: 2.9,
      offsetY: 150,
    },
  ],
  shards: [
    { dx: -190, dy: -70, size: 24, depth: 'back', spin: 0.5, tilt: -12, phase: 0.4 },
    { dx: 100, dy: -165, size: 16, depth: 'back', spin: -0.65, tilt: 18, phase: 2.1 },
    { dx: -150, dy: 125, size: 38, depth: 'front', spin: 0.38, tilt: 10, phase: 1.2 },
    { dx: 115, dy: 105, size: 24, depth: 'front', spin: -0.5, tilt: -16, phase: 4.4 },
    { dx: -25, dy: -225, size: 14, depth: 'front', spin: 0.8, tilt: 6, phase: 3.3 },
  ],
  // Decode: a scanline over a grid; the title scrambles then locks; the eye is scanned.
  motion: { intro: 'datarain', aura: 'cipher', reveal: 'scan', title: 'scramble', eyeScan: true },
};
