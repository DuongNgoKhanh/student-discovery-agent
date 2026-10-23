import butterflyUrl from '../../assets/archetypes/creator/creator.webp';
import type { ArchetypeTheme, ShareCardData } from '../types';

export const creatorContent: ShareCardData = {
  name: 'Nguyễn Minh An',
  archetype: {
    id: 'creator',
    title: 'Người Sáng Tạo',
    subtitle: 'The Creator',
    edition: '04/06',
  },
  strengths: [
    { label: 'Sáng tạo', glyph: '✦' },
    { label: 'Tinh tế', glyph: '◇' },
    { label: 'Cảm hứng', glyph: '✧' },
  ],
  tagline: 'Mỗi người một hành trình riêng',
};

export const creatorTheme: ArchetypeTheme = {
  id: 'creator',
  artwork: {
    src: butterflyUrl,
    alt: 'Bướm pha lê phát sáng tím lam với thân tinh thể',
    provenance: 'Digital Aura butterfly master (1254×1254), served as WebP.',
    focal: { x: 0.515, y: 0.45 },
    bodyAxis: [
      { x: 0.535, y: 0.35 },
      { x: 0.46, y: 0.62 },
    ],
    facets: [
      { x: 0.515, y: 0.42, size: 1 }, // thorax crystal
      { x: 0.53, y: 0.355, size: 0.6 }, // head
      { x: 0.385, y: 0.475, size: 0.55 }, // left wing eye
      { x: 0.59, y: 0.565, size: 0.55 }, // right wing eye
      { x: 0.89, y: 0.22, size: 0.7 }, // upper-right crystal
      { x: 0.26, y: 0.77, size: 0.7 }, // lower-left crystal
      { x: 0.19, y: 0.6, size: 0.5 }, // left orb
      { x: 0.76, y: 0.71, size: 0.45 }, // right orb
    ],
    erase: [],
    feather: { top: 0.06, bottom: 0.2, side: 0.04 },
  },
  palette: {
    backdrop: ['#4a3873', '#1a1533', '#0a0a20'],
    veil: '#0c0b22',
    accent: '#b77cff',
    lavender: '#d8c8ff',
    blue: '#8fd8ff',
    text: '#fbf8ff',
    muted: '#b3abd0',
    chip: 'rgba(83, 64, 139, 0.55)',
    chipBorder: 'rgba(183, 157, 250, 0.7)',
    frame: ['#e4d2ff', '#8f7cf5', '#8fd8ff', '#c79bff'],
    particles: ['#efe6ff', '#bfa3ff', '#9fdcff'],
  },
  ribbons: [
    {
      rx: 214,
      ry: 62,
      tilt: -18,
      colors: ['#f0faff', '#91e9ff', '#b98bff', '#f2a9ff'],
      width: 3.4,
      speed: 0.62,
      phase: -0.4,
      length: 3.9,
      offsetY: 115,
    },
    {
      rx: 190,
      ry: 76,
      tilt: 24,
      colors: ['#fff4ff', '#e3b4ff', '#8e8cff', '#76bfff'],
      width: 2.6,
      speed: -0.48,
      phase: 2.4,
      length: 3.3,
      offsetY: 145,
    },
    {
      rx: 150,
      ry: 40,
      tilt: -4,
      colors: ['#ffffff', '#c9b6ff', '#7fd0ff'],
      width: 1.8,
      speed: 0.9,
      phase: 4.1,
      length: 2.2,
      offsetY: 125,
    },
  ],
  // Chrysalis: opens from the body as the wings unfold; letters bloom.
  motion: { intro: 'pollen', aura: 'flight', reveal: 'unfold', title: 'bloom' },
};
