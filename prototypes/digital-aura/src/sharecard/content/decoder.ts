import lynxUrl from '../../assets/archetypes/decoder/decoder.webp';
import type { ArchetypeTheme, ShareCardData } from '../types';

export const decoderContent: ShareCardData = {
  name: 'Ngân',
  archetype: {
    id: 'decoder',
    title: 'Người Giải Mã',
    subtitle: 'The Decoder',
  },
  strengths: [
    { label: 'Logic', icon: 'brain' },
    { label: 'Tò mò', icon: 'search' },
    { label: 'Chính xác', icon: 'target' },
  ],
  tagline: 'Luôn tìm kiếm quy luật đằng sau những điều phức tạp',
  fields: ['Công nghệ', 'Khoa học', 'Nghiên cứu'],
};

export const decoderTheme: ArchetypeTheme = {
  id: 'decoder',
  artwork: {
    src: lynxUrl,
    alt: 'Linh miêu trắng mắt xanh phát sáng giữa vầng sáng tinh thể',
    provenance: 'Digital Aura lynx master (1254×1254), served as WebP.',
    focal: { x: 0.58, y: 0.45 },
    facets: [
      { x: 0.555, y: 0.405, size: 0.75 }, // eye
      { x: 0.678, y: 0.42, size: 0.45 }, // far eye
      { x: 0.835, y: 0.575, size: 0.7 }, // right crystal
      { x: 0.225, y: 0.76, size: 0.75 }, // lower-left crystal
      { x: 0.175, y: 0.16, size: 0.55 }, // upper-left crystal
      { x: 0.81, y: 0.405, size: 0.45 }, // bubble
      { x: 0.51, y: 0.06, size: 0.6 }, // apex star
    ],
    erase: [],
    feather: { top: 0.06, bottom: 0.22, side: 0.05 },
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
