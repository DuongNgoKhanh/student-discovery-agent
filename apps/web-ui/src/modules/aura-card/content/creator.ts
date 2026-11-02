import type { ArchetypeTheme, ArchetypeCopy } from '../types';

// Served from public/aura/: canvas painters load the artwork from a plain URL.
const butterflyUrl = '/aura/creator.webp';
const butterfly45Url = '/aura/creator-45.webp';

export const creatorContent: ArchetypeCopy = {
  archetype: {
    id: 'creator',
    title: 'Người Sáng Tạo',
    subtitle: 'The Creator',
  },
  strengths: [{ label: 'Sáng tạo' }, { label: 'Tinh tế' }, { label: 'Cảm hứng' }],
  // Footer line under the chips; takes the place of the tagline when set.
  fields: ['Thiết kế', 'Nghệ thuật', 'Truyền thông'],
  tagline: 'Mỗi người một hành trình riêng',
};

export const creatorTheme: ArchetypeTheme = {
  id: 'creator',
  artwork: {
    src: butterflyUrl,
    alt: 'Bướm pha lê phát sáng tím lam với thân tinh thể',
    provenance:
      'Digital Aura butterfly master (844×1264), served as WebP; portrait, fills the card height.',
    // Portrait master, full-bleed: it covers the card height. The wings span ~13%–99.5% of the
    // master's width, so the box is shifted to centre the span and put the wing tips on the card edges.
    // Stretched to the full 400×711 card, so the artwork's proportions are distorted.
    aspect: 711 / 400,
    fit: 'fill',
    box: { x: 0, y: 0, size: 400 },
    focal: { x: 0.578, y: 0.41 },
    bodyAxis: [
      { x: 0.578, y: 0.34 },
      { x: 0.521, y: 0.554 },
    ],
    facets: [
      { x: 0.578, y: 0.41, size: 1 }, // thorax crystal
      { x: 0.578, y: 0.345, size: 0.6 }, // head
      { x: 0.409, y: 0.44, size: 0.55 }, // left wing eye
      { x: 0.643, y: 0.498, size: 0.55 }, // right wing eye
      { x: 0.9, y: 0.277, size: 0.45 }, // upper-right crystal
      { x: 0.231, y: 0.546, size: 0.7 }, // left orb
      { x: 0.871, y: 0.554, size: 0.5 }, // right crystal
      { x: 0.746, y: 0.617, size: 0.45 }, // lower-right orb
    ],
    erase: [],
    feather: { top: 0.02, bottom: 0.04, side: 0.03 },
  },
  palette: {
    backdrop: ['#4a3873', '#1a1533', '#0a0a20'],
    veil: '#0c0b22',
    accent: '#b77cff',
    lavender: '#d8c8ff',
    blue: '#8fd8ff',
    text: '#fbf8ff',
    muted: '#b3abd0',
    chip: 'transparent',
    chipBorder: 'linear-gradient(135deg, rgba(200, 170, 255, 0.95), rgba(110, 190, 255, 0.9))',
    frame: ['#e4d2ff', '#8f7cf5', '#8fd8ff', '#c79bff'],
    particles: ['#efe6ff', '#bfa3ff', '#9fdcff'],
  },
  // No orbit ribbons: the artwork carries the light on its own.
  ribbons: [],
  // Full-bleed artwork: no bottom veil. A soft dark pool behind the identity text keeps the light
  // name and footer legible where the wings and orbs are brightest.
  veil: { start: 711, solid: 711 },
  panel: { y: 560, rx: 260, ry: 175, alpha: 0.8 },
  // Identity block in the lower third, inside the frame (reference card proportions).
  identity: { bottom: 50 },
  // Logo and label sit inside the artwork's frame, clear of its corners.
  header: { top: 40, inset: 55, labelInset: 40 },
  // 4:5 card (400×500): the artwork is stretched to the card, and the identity block and header
  // sit at the layout's own positions so the name, title, chips and footer stack without overlap.
  landscape: {
    // Artwork keeps its proportions and is cropped: the top of the master fills the card, and
    // a near-solid dark block covers the lower part where the identity text sits.
    // 4:5 design: no frame. The butterfly fills the upper part of the card at full width, and a
    // dark gradient (from y≈250, solid from y≈320) carries the name, title, chips and footer.
    // Square master (1254×1254), fitted to the top of the card. Points are normalised to this image.
    artwork: {
      src: butterfly45Url,
      alt: 'Bướm pha lê tím lam với thân tinh thể, nền ánh sáng vũ trụ',
      provenance: 'Digital Aura butterfly 4:5 master (1254×1254), served as WebP.',
      aspect: 1,
      box: { x: 23, y: -20, size: 340 },
      fit: 'width',
      focal: { x: 0.53, y: 0.43 },
      bodyAxis: [
        { x: 0.538, y: 0.35 },
        { x: 0.49, y: 0.606 },
      ],
      facets: [
        { x: 0.53, y: 0.43, size: 1 }, // thorax crystal
        { x: 0.538, y: 0.35, size: 0.6 }, // head
        { x: 0.383, y: 0.478, size: 0.55 }, // left wing eye
        { x: 0.59, y: 0.562, size: 0.55 }, // right wing eye
        { x: 0.745, y: 0.136, size: 0.7 }, // upper-right crystal
        { x: 0.889, y: 0.231, size: 0.7 }, // right crystal
        { x: 0.263, y: 0.757, size: 0.7 }, // lower-left crystal
        { x: 0.187, y: 0.602, size: 0.5 }, // left orb
        { x: 0.761, y: 0.706, size: 0.45 }, // lower-right orb
        { x: 0.889, y: 0.55, size: 0.5 }, // right crystal, lower
      ],
    },
    veil: { start: 250, solid: 320 },
    // Frame in the decoder's style: blue-violet rim and hairline.
    frame: true,
    palette: {
      frame: ['#e0ecff', '#7f9cff', '#8fe3ff', '#b8a6ff'],
      glow: '#4f6dff',
    },
    identity: { bottom: 10 },
    header: { top: 26, inset: 28, labelInset: 28 },
  },
  // Chrysalis: opens from the body as the wings unfold; letters bloom.
  motion: { intro: 'pollen', aura: 'orbit', reveal: 'unfold', title: 'bloom' },
  // Prism pulse: facets flash on the beat once the aura sweep settles.
  rhythm: { bpm: 80 },
};
