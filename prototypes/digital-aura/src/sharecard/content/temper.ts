import otterUrl from '../../assets/archetypes/temper/temper.webp';
import type { ArchetypeTheme, ShareCardData } from '../types';

export const temperContent: ShareCardData = {
  name: 'Bảo Anh',
  archetype: {
    id: 'temper',
    title: 'Người Giữ Nhịp',
    subtitle: 'The Rhythm Keeper',
  },
  strengths: [
    { label: 'Cảm nhận nhịp', icon: 'heart' },
    { label: 'Hòa hợp', icon: 'eye' },
    { label: 'Nhất quán', icon: 'users' },
  ],
  tagline: 'Giữ nhịp giúp ta kết nối với chính mình và những người xung quanh',
  fields: ['Công nghệ', 'Khoa học', 'Nghiên cứu'],
};

export const temperTheme: ArchetypeTheme = {
  id: 'temper',
  artwork: {
    src: otterUrl,
    alt: 'Rái cá vươn mình giữa dòng nước xoáy, bọt nước và tinh thể xanh ngọc',
    provenance: 'Digital Aura otter master (1254×1254), served as WebP.',
    focal: { x: 0.55, y: 0.45 },
    // On the beat, these light up one after another.
    facets: [
      { x: 0.535, y: 0.19, size: 0.5 }, // eye
      { x: 0.83, y: 0.15, size: 0.65 }, // upper-right crystal
      { x: 0.74, y: 0.8, size: 0.75 }, // lower-right crystal
      { x: 0.39, y: 0.62, size: 0.7 }, // centre crystal
      { x: 0.11, y: 0.43, size: 0.6 }, // left crystal
      { x: 0.3, y: 0.18, size: 0.65 }, // upper-left crystal
      { x: 0.54, y: 0.78, size: 0.45 }, // bubble
      { x: 0.2, y: 0.81, size: 0.45 }, // bubble
    ],
    erase: [],
    feather: { top: 0.05, bottom: 0.2, side: 0.04 },
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
