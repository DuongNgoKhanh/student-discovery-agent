import type { ArchetypeCopy, ArchetypeId, ArchetypeTheme } from '../types';
import { creatorContent, creatorTheme } from './creator';
import { decoderContent, decoderTheme } from './decoder';
import { healerContent, healerTheme } from './healer';
import { leaderContent, leaderTheme } from './leader';
import { storytellerContent, storytellerTheme } from './storyteller';
import { temperContent, temperTheme } from './temper';

export interface ArchetypeEntry {
  /** Card copy (title, English subtitle, short strengths, fields). The name comes from the result. */
  content: ArchetypeCopy;
  theme: ArchetypeTheme;
}

/** Register additional SDA archetypes here; components only ever read from an entry. */
export const archetypes: Record<string, ArchetypeEntry> = {
  creator: { content: creatorContent, theme: creatorTheme },
  decoder: { content: decoderContent, theme: decoderTheme },
  healer: { content: healerContent, theme: healerTheme },
  leader: { content: leaderContent, theme: leaderTheme },
  temper: { content: temperContent, theme: temperTheme },
  storyteller: { content: storytellerContent, theme: storytellerTheme },
};

/**
 * Backend RIASEC houses → card archetype. Agreed mapping: Artistic → Creator, Investigative →
 * Decoder, Social → Healer, Enterprising → Guide (leader), Conventional → Rhythm Keeper (temper),
 * Realistic → Storyteller. Keyed by both `theme_ref` and `house_id`, so either one selects it.
 */
const houseArchetypes: Record<string, ArchetypeId> = {
  theme_artistic_amber: 'creator',
  theme_investigative_sapphire: 'decoder',
  theme_social_emerald: 'healer',
  theme_enterprising_ruby: 'leader',
  theme_conventional_amethyst: 'temper',
  theme_realistic_crimson: 'storyteller',
  house_a: 'creator',
  house_i: 'decoder',
  house_s: 'healer',
  house_e: 'leader',
  house_c: 'temper',
  house_r: 'storyteller',
};

/** The archetype for a result's house, or null when the house has no card design yet. */
export function archetypeForHouse(house: {
  theme_ref: string;
  house_id: string;
}): ArchetypeEntry | null {
  const id = houseArchetypes[house.theme_ref] ?? houseArchetypes[house.house_id];
  return id ? (archetypes[id] ?? null) : null;
}

/**
 * Brand marks shared by every archetype. IHRD owns the project and is the primary identity;
 * the card shows the full logo in a light version (navy turned white, red accents kept) derived
 * from `logo-IHRD/Logo-IHRD.png`, which stays untouched.
 */
export const brand = {
  logo: {
    src: '/aura/ihrd-logo-light.png',
    alt: 'IHRD — Viện Khoa học Ứng dụng và Phát triển Nhân lực',
    /** Width / height of the logo image. */
    aspect: 600 / 318,
  },
  label: 'Self Discovery',
} as const;
