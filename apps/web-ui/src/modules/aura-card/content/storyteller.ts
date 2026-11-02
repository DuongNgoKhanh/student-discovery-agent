import type { ArchetypeTheme, ArchetypeCopy } from '../types';

// Served from public/aura/: canvas painters load the artwork from a plain URL.
const foxUrl = '/aura/storyteller.webp';
const fox45Url = '/aura/storyteller-45.webp';

export const storytellerContent: ArchetypeCopy = {
  archetype: {
    id: 'storyteller',
    title: 'Người Kể Chuyện',
    subtitle: 'The Storyteller',
  },
  strengths: [{ label: 'Biểu đạt' }, { label: 'Thấu hiểu' }, { label: 'Kết nối' }],
  tagline: 'Những câu chuyện kết nối trái tim, giúp ta thấy mình không đơn độc',
  fields: ['Công nghệ', 'Khoa học', 'Nghiên cứu'],
};

export const storytellerTheme: ArchetypeTheme = {
  id: 'storyteller',
  artwork: {
    src: foxUrl,
    alt: 'Cáo đỏ ngẩng nhìn trước vầng trăng hồng, giữa hoa sen và tinh thể hồng ngọc',
    provenance: 'Digital Aura fox master (1254×1254), served as WebP.',
    // Full-bleed 9:16 master (941×1672): fitted to the card, as for creator.
    aspect: 711 / 400,
    fit: 'fill',
    box: { x: 0, y: 0, size: 400 },
    focal: { x: 0.5, y: 0.42 },
    bodyAxis: [
      { x: 0.595, y: 0.239 },
      { x: 0.425, y: 0.478 },
    ],
    facets: [
      { x: 0.627, y: 0.293, size: 0.6 }, // eye
      { x: 0.191, y: 0.138, size: 0.6 }, // upper-left crystal
      { x: 0.871, y: 0.293, size: 0.65 }, // right crystal
      { x: 0.202, y: 0.478, size: 0.75 }, // left crystal
      { x: 0.181, y: 0.598, size: 0.6 }, // left flower
      { x: 0.84, y: 0.466, size: 0.55 }, // right flower
      { x: 0.85, y: 0.813, size: 0.55 }, // lower-right crystal
      { x: 0.914, y: 0.478, size: 0.45 }, // right orb
    ],
    halo: { x: 0.55, y: 0.27, radius: 0.25, rays: false },
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
      src: fox45Url,
      aspect: 1,
      box: { x: 23, y: -20, size: 340 },
      fit: 'width',
      focal: { x: 0.5, y: 0.5 },
      bodyAxis: [
        { x: 0.51, y: 0.303 },
        { x: 0.359, y: 0.558 },
      ],
      facets: [
        { x: 0.55, y: 0.239, size: 0.5 }, // eye
        { x: 0.279, y: 0.159, size: 0.7 }, // upper-left crystal
        { x: 0.797, y: 0.239, size: 0.6 }, // upper-right crystal
        { x: 0.263, y: 0.447, size: 0.7 }, // left crystal
        { x: 0.239, y: 0.638, size: 0.8 }, // lower-left crystal
        { x: 0.821, y: 0.455, size: 0.6 }, // right crystal
        { x: 0.781, y: 0.574, size: 0.5 }, // right flower
        { x: 0.383, y: 0.734, size: 0.5 }, // lower flower
      ],
      halo: { x: 0.538, y: 0.251, radius: 0.21, rays: false },
    },
    veil: { start: 250, solid: 320 },
    identity: { bottom: 22 },
    header: { top: 26, inset: 28, labelInset: 28 },
  },
  palette: {
    backdrop: ['#6a1f2c', '#2b0a12', '#120408'],
    veil: '#160609',
    accent: '#ff8fa3',
    lavender: '#ffd6dc',
    blue: '#ffb38a',
    text: '#fff6f7',
    muted: '#d3aab1',
    chip: 'rgba(110, 26, 44, 0.5)',
    chipBorder: 'rgba(255, 150, 170, 0.75)',
    frame: ['#ffe0e5', '#ff6f8b', '#ffc2a8', '#e84a6a'],
    particles: ['#ffe8ec', '#ff8fa3', '#ffc29a'],
    glow: '#d6334f',
  },
  ribbons: [
    {
      rx: 200,
      ry: 64,
      tilt: -14,
      colors: ['#ffffff', '#ffd0d8', '#ff7d96', '#ff4f72'],
      width: 3,
      speed: 0.5,
      phase: 1.2,
      length: 3.6,
      offsetY: 80,
    },
    {
      rx: 168,
      ry: 52,
      tilt: 18,
      colors: ['#fff4f0', '#ffb38a', '#ff6f8b'],
      width: 2,
      speed: -0.42,
      phase: 3.9,
      length: 2.8,
      offsetY: 120,
    },
  ],
  shards: [
    { dx: -185, dy: -70, size: 18, depth: 'back', spin: 0.45, tilt: -12, phase: 0.8 },
    { dx: 170, dy: 60, size: 20, depth: 'front', spin: -0.4, tilt: 14, phase: 4 },
  ],
  particleShape: 'petal',
  // Ink: the image spreads like ink with an ember edge; the title is told word by word.
  motion: { intro: 'embers', aura: 'threads', reveal: 'ink', title: 'word', flicker: true },
};
