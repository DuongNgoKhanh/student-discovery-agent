import { Montserrat, Noto_Serif_Display } from 'next/font/google';

/**
 * The share card's own faces. Applied as CSS variables on the card root (Tailwind `font-card`,
 * `font-card-title`). The PNG exporter reads the resolved family from computed styles, so the
 * hashed next/font names need no special handling.
 */
export const cardSans = Montserrat({
  subsets: ['latin', 'vietnamese'],
  weight: ['300', '400', '600'],
  variable: '--font-card',
  display: 'swap',
});

/** Headline serif: places stacked Vietnamese diacritics ("Dẫn", "Chữa", "Giữ") cleanly. */
export const cardTitle = Noto_Serif_Display({
  subsets: ['latin', 'vietnamese'],
  weight: ['500'],
  variable: '--font-card-title',
  display: 'swap',
});
