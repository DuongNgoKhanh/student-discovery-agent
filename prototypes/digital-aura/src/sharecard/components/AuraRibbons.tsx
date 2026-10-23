import { paintAura } from '../render/motifs';
import { paintRibbons } from '../render/painters';
import { Z } from '../render/scene';
import { useSceneLayer } from './scene-context';

/**
 * The moving aura around the hero from phase 2 onward, chosen by `theme.motion.aura`. The
 * default `orbit` draws elliptical ribbons split into back and front halves so the orbit reads
 * in depth; the other styles (flight paths, cipher rings, helix, light path, sound waves,
 * calligraphic threads) are drawn in front. Colours come from the theme's ribbons.
 */
export function AuraRibbons() {
  useSceneLayer(Z.ribbonsBack, (ctx, frame) => {
    if ((frame.theme.motion?.aura ?? 'orbit') === 'orbit') paintRibbons(ctx, frame, 'back');
  });
  useSceneLayer(Z.ribbonsFront, (ctx, frame) => {
    const aura = frame.theme.motion?.aura ?? 'orbit';
    if (aura === 'orbit') paintRibbons(ctx, frame, 'front');
    else paintAura(ctx, frame, aura);
  });
  return null;
}
