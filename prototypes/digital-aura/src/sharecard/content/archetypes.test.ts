import { describe, expect, it, vi } from 'vitest';

// Vite resolves image imports to URLs; in Node they only need to be strings.
vi.mock('../../assets/archetypes/creator/creator.webp', () => ({
  default: 'creator.jpg',
}));
vi.mock('../../assets/archetypes/decoder/decoder.webp', () => ({
  default: 'decoder.jpg',
}));

vi.mock('../../assets/archetypes/healer/healer.webp', () => ({
  default: 'healer.jpg',
}));

vi.mock('../../assets/archetypes/leader/leader.webp', () => ({
  default: 'leader.webp',
}));

vi.mock('../../assets/archetypes/temper/temper.webp', () => ({
  default: 'temper.webp',
}));
vi.mock('../../assets/archetypes/story-teller/storyteller.webp', () => ({
  default: 'storyteller.webp',
}));

const { archetypes, defaultArchetype } = await import('./index');

const inUnit = (n: number) => n >= 0 && n <= 1;
const hex = /^#[0-9a-f]{6}$/i;

describe.each(Object.entries(archetypes))('archetype %s', (id, { content, theme }) => {
  it('content and theme describe the same archetype', () => {
    expect(content.archetype.id).toBe(id);
    expect(theme.id).toBe(id);
  });

  it('has displayable content', () => {
    expect(content.name.trim()).not.toBe('');
    expect(content.archetype.title.trim()).not.toBe('');
    expect(content.strengths.length).toBeGreaterThan(0);
    expect(content.strengths.length).toBeLessThanOrEqual(3);
    for (const s of content.strengths) expect(s.label.trim()).not.toBe('');
  });

  it('places artwork points inside the image', () => {
    const { artwork } = theme;
    const points = [
      artwork.focal,
      ...artwork.facets,
      ...(artwork.bodyAxis ?? []),
      ...(artwork.halo ? [artwork.halo] : []),
      ...(artwork.ripples ? [artwork.ripples] : []),
    ];
    for (const p of points) expect(inUnit(p.x) && inUnit(p.y)).toBe(true);
  });

  it('uses hex colours where painters parse them', () => {
    const { palette } = theme;
    for (const c of [
      palette.accent,
      palette.lavender,
      palette.blue,
      palette.veil,
      ...palette.frame,
      ...palette.particles,
    ])
      expect(c).toMatch(hex);
    for (const r of theme.ribbons) for (const c of r.colors) expect(c).toMatch(hex);
  });
});

it('the default archetype is registered', () => {
  expect(archetypes[defaultArchetype]).toBeDefined();
});
