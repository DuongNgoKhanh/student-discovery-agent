import heronUrl from '../../assets/archetypes/healer/healer.webp';
import heron45Url from '../../assets/archetypes/healer/healer-45.webp';
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
    // Full-bleed 9:16 master (941×1672): fitted to the card, as for creator.
    aspect: 711 / 400,
    fit: 'fill',
    box: { x: 0, y: 0, size: 400 },
    focal: { x: 0.6, y: 0.45 },
    bodyAxis: [
      { x: 0.68, y: 0.281 },
      { x: 0.595, y: 0.538 },
    ],
    facets: [
      { x: 0.707, y: 0.293, size: 0.6 }, // eye
      { x: 0.808, y: 0.43, size: 0.5 }, // lotus right
      { x: 0.244, y: 0.55, size: 0.75 }, // lower-left crystal
      { x: 0.181, y: 0.155, size: 0.6 }, // upper-left crystal
      { x: 0.872, y: 0.317, size: 0.7 }, // right crystal
      { x: 0.914, y: 0.508, size: 0.5 }, // right bubble
      { x: 0.117, y: 0.628, size: 0.45 }, // lotus left
      { x: 0.149, y: 0.849, size: 0.4 }, // bottom-left bubble
    ],
    halo: { x: 0.7, y: 0.29, radius: 0.12 },
    ripples: { x: 0.5, y: 0.6, rx: 0.34, ry: 0.04 },
    erase: [],
    feather: { top: 0.05, bottom: 0.12, side: 0.05 },
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
      src: heron45Url,
      aspect: 1,
      box: { x: 23, y: -20, size: 340 },
      fit: 'width',
      focal: { x: 0.5, y: 0.45 },
      bodyAxis: [
        { x: 0.47, y: 0.239 },
        { x: 0.494, y: 0.718 },
      ],
      facets: [
        { x: 0.478, y: 0.478, size: 1 }, // emerald pendant
        { x: 0.466, y: 0.231, size: 0.6 }, // eye
        { x: 0.279, y: 0.112, size: 0.6 }, // upper-left crystal
        { x: 0.183, y: 0.478, size: 0.65 }, // left crystal
        { x: 0.861, y: 0.136, size: 0.65 }, // upper-right crystal
        { x: 0.845, y: 0.566, size: 0.5 }, // right crystal
        { x: 0.494, y: 0.845, size: 0.5 }, // base glow
      ],
        halo: { x: 0.494, y: 0.255, radius: 0.11 },
        ripples: { x: 0.5, y: 0.85, rx: 0.3, ry: 0.05 },
    },
    veil: { start: 250, solid: 320 },
    identity: { bottom: 22 },
    header: { top: 26, inset: 28, labelInset: 28 },
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
