import { describe, expect, it } from 'vitest';
import { archetypeForHouse, archetypes } from './index';

const inUnit = (n: number) => n >= 0 && n <= 1;
const hex = /^#[0-9a-f]{6}$/i;

describe.each(Object.entries(archetypes))('archetype %s', (id, { content, theme }) => {
  it('content and theme describe the same archetype', () => {
    expect(content.archetype.id).toBe(id);
    expect(theme.id).toBe(id);
  });

  it('has displayable content', () => {
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

describe('archetypeForHouse', () => {
  // The six backend RIASEC houses (holland_career_pool.py) and the agreed card for each.
  it.each([
    ['theme_artistic_amber', 'house_a', 'creator'],
    ['theme_investigative_sapphire', 'house_i', 'decoder'],
    ['theme_social_emerald', 'house_s', 'healer'],
    ['theme_enterprising_ruby', 'house_e', 'leader'],
    ['theme_conventional_amethyst', 'house_c', 'temper'],
    ['theme_realistic_crimson', 'house_r', 'storyteller'],
  ])('%s / %s → %s', (theme_ref, house_id, id) => {
    expect(archetypeForHouse({ theme_ref, house_id })?.theme.id).toBe(id);
    // Either reference alone is enough.
    expect(archetypeForHouse({ theme_ref: 'unknown', house_id })?.theme.id).toBe(id);
    expect(archetypeForHouse({ theme_ref, house_id: 'unknown' })?.theme.id).toBe(id);
  });

  it('returns null for a house without a card design', () => {
    expect(archetypeForHouse({ theme_ref: 'theme_demo_a', house_id: 'house_demo_a' })).toBeNull();
  });
});
