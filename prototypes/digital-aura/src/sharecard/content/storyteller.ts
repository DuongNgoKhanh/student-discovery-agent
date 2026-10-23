import foxUrl from '../../assets/archetypes/story-teller/storyteller.webp';
import type { ArchetypeTheme, ShareCardData } from '../types';

export const storytellerContent: ShareCardData = {
  name: 'Khánh Linh',
  archetype: {
    id: 'storyteller',
    title: 'Người Kể Chuyện',
    subtitle: 'The Storyteller',
  },
  strengths: [
    { label: 'Biểu đạt', icon: 'heart' },
    { label: 'Thấu hiểu', icon: 'eye' },
    { label: 'Kết nối', icon: 'users' },
  ],
  tagline: 'Những câu chuyện kết nối trái tim, giúp ta thấy mình không đơn độc',
  fields: ['Công nghệ', 'Khoa học', 'Nghiên cứu'],
};

export const storytellerTheme: ArchetypeTheme = {
  id: 'storyteller',
  artwork: {
    src: foxUrl,
    alt: 'Cáo đỏ ngẩng nhìn trước vầng trăng hồng, giữa hoa sen và tinh thể hồng ngọc',
    provenance: 'Digital Aura fox master (1254×1254), served as WebP.',
    focal: { x: 0.5, y: 0.5 },
    facets: [
      { x: 0.535, y: 0.23, size: 0.5 }, // eye
      { x: 0.29, y: 0.16, size: 0.7 }, // upper-left crystal
      { x: 0.79, y: 0.23, size: 0.6 }, // upper-right crystal
      { x: 0.27, y: 0.44, size: 0.7 }, // left crystal
      { x: 0.24, y: 0.6, size: 0.8 }, // large lower-left crystal
      { x: 0.83, y: 0.48, size: 0.6 }, // right crystal
    ],
    // The moon disc behind the fox: a soft glow, no rays (rays belong to the Guide's sunrise).
    halo: { x: 0.53, y: 0.27, radius: 0.21, rays: false },
    erase: [],
    feather: { top: 0.05, bottom: 0.2, side: 0.04 },
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
