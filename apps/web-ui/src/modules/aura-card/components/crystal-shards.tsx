import { paintShards } from '../render/painters';
import { Z } from '../render/scene';
import { useSceneLayer } from './scene-context';

/**
 * Faceted crystal shards floating around the hero. They pop in during the aura sweep, then
 * spin, bob and pulse with the crystal light. Positions come from `theme.shards`; themes
 * without shards paint nothing.
 */
export function CrystalShards() {
  useSceneLayer(Z.shardsBack, (ctx, frame) => paintShards(ctx, frame, 'back'));
  useSceneLayer(Z.shardsFront, (ctx, frame) => paintShards(ctx, frame, 'front'));
  return null;
}
