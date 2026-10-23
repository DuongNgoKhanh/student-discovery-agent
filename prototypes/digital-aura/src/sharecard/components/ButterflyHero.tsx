import { useEffect, useRef, useState } from 'react';
import { prepareArtwork, type PreparedArtwork } from '../render/artwork';
import { paintButterfly } from '../render/painters';
import { Z } from '../render/scene';
import type { ArtworkAsset } from '../types';
import { useScene, useSceneLayer } from './scene-context';

interface ButterflyHeroProps {
  artwork: ArtworkAsset;
  onError?: (message: string) => void;
  /** Fires once the artwork is decoded and masked, so playback can start the reveal. */
  onReady?: () => void;
}

/**
 * The archetype artwork: radial light reveal, 0.9 → 1 scale, bloom, crystal facet light and
 * wing breathing. Renders nothing until the artwork is decoded and masked.
 */
export function ButterflyHero({ artwork, onError, onReady }: ButterflyHeroProps) {
  const scene = useScene();
  const [prepared, setPrepared] = useState<{ asset: ArtworkAsset; art: PreparedArtwork } | null>(
    null,
  );

  // Latest callback without re-running the preparation effect when its identity changes.
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    let cancelled = false;
    const work = prepareArtwork(artwork);
    scene.track(work);
    work.then(
      (art) => {
        if (cancelled) return;
        setPrepared({ asset: artwork, art });
        ready.current?.();
      },
      () => !cancelled && onError?.('Không thể tải ảnh artwork. Hãy thử một tệp ảnh khác.'),
    );
    return () => {
      cancelled = true;
    };
  }, [artwork, scene, onError]);

  useSceneLayer(
    Z.hero,
    prepared ? (ctx, frame) => paintButterfly(ctx, frame, prepared.art, prepared.asset) : null,
  );
  return null;
}
