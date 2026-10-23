import ihrdLogoUrl from '../../assets/archetypes/logo-IHRD/ihrd-logo-light.png';
import type { ArchetypeId, ArchetypeTheme, ShareCardData } from '../types';
import { creatorContent, creatorTheme } from './creator';
import { decoderContent, decoderTheme } from './decoder';
import { healerContent, healerTheme } from './healer';
import { leaderContent, leaderTheme } from './leader';
import { storytellerContent, storytellerTheme } from './storyteller';
import { temperContent, temperTheme } from './temper';

export interface ArchetypeEntry {
  content: ShareCardData;
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

export const defaultArchetype: ArchetypeId = 'creator';

/** Brand marks shared by every archetype. */
/**
 * Brand marks shared by every archetype. IHRD owns the project and is the primary identity;
 * the card shows the full logo in a light version (navy turned white, red accents kept) derived
 * from `logo-IHRD/Logo-IHRD.png`, which stays untouched.
 */
export const brand = {
  logo: {
    src: ihrdLogoUrl,
    alt: 'IHRD — Viện Khoa học Ứng dụng và Phát triển Nhân lực',
    /** Width / height of the logo image. */
    aspect: 600 / 318,
  },
  label: 'Self Discovery',
} as const;
