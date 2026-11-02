'use client';

import dynamic from 'next/dynamic';

// Public surface of the result card module. Import only from here.

/**
 * The animated card loads on demand and only in the browser: canvas, Motion and the card fonts
 * stay out of the server render and the chat's first bundle.
 */
export const AuraCard = dynamic(() => import('./components/aura-card').then((m) => m.AuraCard), {
  ssr: false,
  loading: () => (
    <div
      aria-hidden="true"
      className="mx-auto aspect-[9/16] w-full max-w-[340px] animate-pulse rounded-[28px] bg-muted"
    />
  ),
});

export { archetypeForHouse, type ArchetypeEntry } from './content';
