import deerUrl from '../../assets/archetypes/leader/leader.webp';
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
    fit: 'width',
    aspect: 1448 / 1086,
    focal: { x: 0.55, y: 0.45 },
    facets: [
      { x: 0.62, y: 0.27, size: 0.6 }, // eye
      { x: 0.85, y: 0.08, size: 0.7 }, // upper-right crystal
      { x: 0.12, y: 0.22, size: 0.6 }, // upper-left crystal
      { x: 0.25, y: 0.29, size: 0.5 }, // left orb
      { x: 0.86, y: 0.43, size: 0.55 }, // right orb
      { x: 0.13, y: 0.52, size: 0.75 }, // large left crystal
      { x: 0.37, y: 0.77, size: 0.5 }, // lower orb
    ],
    // The sun disc behind the head: a sunrise that flares as the identity appears.
    halo: { x: 0.53, y: 0.31, radius: 0.2 },
    erase: [],
    feather: { top: 0.04, bottom: 0.18, side: 0.04 },
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
