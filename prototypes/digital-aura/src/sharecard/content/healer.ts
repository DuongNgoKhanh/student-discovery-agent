import heronUrl from '../../assets/archetypes/healer/healer.webp';
import type { ArchetypeTheme, ShareCardData } from '../types';

export const healerContent: ShareCardData = {
  name: 'Thảo Vy',
  archetype: {
    id: 'healer',
    title: 'Người Chữa Lành',
    subtitle: 'The Healer',
  },
  strengths: [
    { label: 'Chữa lành', icon: 'leaf' },
    { label: 'Điềm tĩnh', icon: 'waves' },
    { label: 'Thấu cảm', icon: 'heart' },
  ],
  tagline: 'Sự chữa lành bắt đầu khi bạn lắng nghe chính mình',
  fields: ['Sức khỏe', 'Cộng đồng', 'Tâm lý'],
};

export const healerTheme: ArchetypeTheme = {
  id: 'healer',
  artwork: {
    src: heronUrl,
    alt: 'Diệc trắng sải cánh trong vầng hào quang ngọc lục bảo, đeo mặt dây ngọc',
    provenance: 'Digital Aura heron master (1254×1254), served as WebP.',
    focal: { x: 0.52, y: 0.45 },
    facets: [
      { x: 0.445, y: 0.465, size: 1 }, // emerald pendant
      { x: 0.47, y: 0.228, size: 0.45 }, // eye
      { x: 0.275, y: 0.105, size: 0.6 }, // upper-left crystal
      { x: 0.185, y: 0.44, size: 0.65 }, // left crystal
      { x: 0.865, y: 0.155, size: 0.65 }, // upper-right crystal
      { x: 0.81, y: 0.78, size: 0.5 }, // lower-right crystal
    ],
    halo: { x: 0.475, y: 0.245, radius: 0.095 },
    ripples: { x: 0.5, y: 0.855, rx: 0.3, ry: 0.05 },
    erase: [],
    feather: { top: 0.05, bottom: 0.12, side: 0.05 },
  },
  palette: {
    backdrop: ['#1d5a4c', '#0c2a25', '#051412'],
    veil: '#061915',
    accent: '#e7cd8f',
    lavender: '#d3f0e4',
    blue: '#7ff0cf',
    text: '#f4fbf7',
    muted: '#a6c5b9',
    chip: 'rgba(22, 82, 68, 0.5)',
    chipBorder: 'rgba(214, 190, 128, 0.7)',
    frame: ['#f0dca6', '#7ff0cf', '#d9c07e', '#a6f5dc'],
    particles: ['#fff6dc', '#bff7e4', '#e9d49a'],
    glow: '#1fbf8f',
  },
  ribbons: [
    {
      rx: 190,
      ry: 62,
      tilt: -14,
      colors: ['#ffffff', '#9ff5dc', '#3fd1a8', '#e7cd8f'],
      width: 3,
      speed: 0.5,
      phase: 1,
      length: 3.6,
      offsetY: 70,
    },
    {
      rx: 160,
      ry: 50,
      tilt: 20,
      colors: ['#fff8e0', '#e7cd8f', '#5fe0b8'],
      width: 2,
      speed: -0.4,
      phase: 3.8,
      length: 2.8,
      offsetY: 120,
    },
  ],
  shards: [
    { dx: -185, dy: -40, size: 20, depth: 'back', spin: 0.45, tilt: -8, phase: 0.9 },
    { dx: 160, dy: -150, size: 13, depth: 'back', spin: -0.6, tilt: 14, phase: 2.6 },
    { dx: 165, dy: 60, size: 18, depth: 'front', spin: -0.4, tilt: -10, phase: 4.1 },
  ],
  // From the water: light rises from the ripples; the title surfaces on a slow breath.
  motion: { intro: 'fireflies', aura: 'helix', reveal: 'rise', title: 'breath', pulsePeriod: 5000 },
};
