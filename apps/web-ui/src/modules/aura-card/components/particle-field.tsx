import { useMemo } from 'react';
import {
  createConvergers,
  createParticles,
  paintConvergers,
  paintParticles,
} from '../render/painters';
import { paintIntro } from '../render/motifs';
import { Z } from '../render/scene';
import { useSceneLayer } from './scene-context';

interface ParticleFieldProps {
  /** `far` sits behind the hero; `near` floats in front of it with stronger parallax. */
  layer: 'far' | 'near';
  height: number;
  colors: readonly string[];
  count?: number;
}

/** Depth-layered ambient particles, plus the archetype's opening effect on the near layer. */
export function ParticleField({ layer, height, colors, count = 46 }: ParticleFieldProps) {
  const particles = useMemo(() => {
    const all = createParticles(count, height, colors);
    return all.filter((p) => (layer === 'far' ? p.depth < 2 : p.depth === 2));
  }, [count, height, colors, layer]);
  const convergers = useMemo(
    () => (layer === 'near' ? createConvergers(42, colors) : []),
    [layer, colors],
  );

  useSceneLayer(layer === 'far' ? Z.farParticles : Z.nearParticles, (ctx, frame) => {
    paintParticles(ctx, frame, particles);
    if (layer !== 'near') return;
    // The opening effect is per archetype; `converge` is the shared default.
    const intro = frame.theme.motion?.intro ?? 'converge';
    if (intro === 'converge') paintConvergers(ctx, frame, convergers);
    else paintIntro(ctx, frame, intro);
  });
  return null;
}
