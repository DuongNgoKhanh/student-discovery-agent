import deerUrl from '../../assets/archetypes/leader/leader.webp';
import deer45Url from '../../assets/archetypes/leader/leader-45.webp';
import type { ArchetypeTheme, ShareCardData } from '../types';

export const leaderContent: ShareCardData = {
  name: 'Gia Huy',
  archetype: {
    id: 'leader',
    title: 'Người Dẫn Đường',
    subtitle: 'The Guide',
  },
  strengths: [
    { label: 'Đồng cảm', icon: 'heart' },
    { label: 'Góc nhìn', icon: 'eye' },
    { label: 'Lãnh đạo', icon: 'user' },
  ],
  tagline: 'Đồng hành để mỗi người tìm thấy con đường của mình',
  fields: ['Công nghệ', 'Khoa học', 'Nghiên cứu'],
};

export const leaderTheme: ArchetypeTheme = {
  id: 'leader',
  artwork: {
    src: deerUrl,
    alt: 'Hươu vàng sừng ánh kim ngẩng đầu trước mặt trời bình minh trên núi',
    provenance: 'Digital Aura deer master (1086×1448, portrait), served as WebP.',
    // Full-bleed 9:16 master (941×1672): fitted to the card, as for creator.
    aspect: 711 / 400,
    fit: 'fill',
    box: { x: 0, y: 0, size: 400 },
    focal: { x: 0.55, y: 0.5 },
    bodyAxis: [
      { x: 0.691, y: 0.359 },
      { x: 0.553, y: 0.598 },
    ],
    facets: [
      { x: 0.648, y: 0.389, size: 0.6 }, // eye
      { x: 0.085, y: 0.072, size: 0.5 }, // upper-left crystal
      { x: 0.914, y: 0.072, size: 0.5 }, // upper-right crystal
      { x: 0.893, y: 0.311, size: 0.6 }, // right crystal
      { x: 0.893, y: 0.556, size: 0.6 }, // right orb
      { x: 0.191, y: 0.526, size: 0.75 }, // left crystal
      { x: 0.064, y: 0.634, size: 0.5 }, // lower-left crystal
      { x: 0.351, y: 0.61, size: 0.5 }, // centre crystal
    ],
    halo: { x: 0.55, y: 0.3, radius: 0.27 },
    erase: [],
    feather: { top: 0.04, bottom: 0.18, side: 0.04 },
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
      src: deer45Url,
      aspect: 1.333333,
      box: { x: 23, y: -20, size: 340 },
      fit: 'width',
      focal: { x: 0.55, y: 0.5 },
      bodyAxis: [
        { x: 0.635, y: 0.29 },
        { x: 0.497, y: 0.69 },
      ],
      facets: [
        { x: 0.612, y: 0.276, size: 0.6 }, // eye
        { x: 0.12, y: 0.228, size: 0.5 }, // upper-left crystal
        { x: 0.847, y: 0.097, size: 0.6 }, // upper-right crystal
        { x: 0.866, y: 0.304, size: 0.5 }, // right crystal
        { x: 0.856, y: 0.435, size: 0.6 }, // right orb
        { x: 0.12, y: 0.497, size: 0.75 }, // left crystal
        { x: 0.249, y: 0.283, size: 0.5 }, // left orb
        { x: 0.378, y: 0.773, size: 0.5 }, // lower orb
      ],
        halo: { x: 0.63, y: 0.3, radius: 0.27 },
    },
    veil: { start: 250, solid: 320 },
    identity: { bottom: 22 },
    header: { top: 26, inset: 28, labelInset: 28 },
  },
  palette: {
    backdrop: ['#6b4a1c', '#2a1a0c', '#0e0905'],
    veil: '#120c06',
    accent: '#ffc861',
    lavender: '#ffe9c2',
    blue: '#ffe2a0',
    text: '#fffaf0',
    muted: '#cdbb9a',
    chip: 'rgba(92, 62, 22, 0.5)',
    chipBorder: 'rgba(255, 205, 120, 0.75)',
    frame: ['#fff0c8', '#ffc861', '#ffe7a8', '#e0a640'],
    particles: ['#fff4d6', '#ffd27a', '#ffe9b8'],
    glow: '#d99a2b',
  },
  ribbons: [
    {
      rx: 200,
      ry: 66,
      tilt: -16,
      colors: ['#ffffff', '#ffe7a8', '#ffc45c', '#ff9f3a'],
      width: 3,
      speed: 0.5,
      phase: 0.8,
      length: 3.6,
      offsetY: 70,
    },
    {
      rx: 170,
      ry: 54,
      tilt: 18,
      colors: ['#fff8e6', '#ffd27a', '#e8953a'],
      width: 2,
      speed: -0.42,
      phase: 3.6,
      length: 2.8,
      offsetY: 115,
    },
  ],
  shards: [
    { dx: -195, dy: -60, size: 20, depth: 'back', spin: 0.45, tilt: -10, phase: 0.6 },
    { dx: 150, dy: -175, size: 13, depth: 'back', spin: -0.6, tilt: 12, phase: 2.4 },
    { dx: 170, dy: 85, size: 20, depth: 'front', spin: -0.4, tilt: -14, phase: 4.2 },
  ],
  // Dawn: the sun first, then light climbs from the horizon; the title lights up like a path.
  motion: { intro: 'sunrays', aura: 'path', reveal: 'dawn', title: 'path' },
};
