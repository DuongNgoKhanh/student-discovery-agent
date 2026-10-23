import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import type { FrameState, SceneLayer } from '../render/scene';

export interface SceneRegistry {
  register(layer: SceneLayer): () => void;
  /** Request a repaint on the next frame (coalesced). */
  invalidate(): void;
  /** Track async work (e.g. artwork decoding) that export must wait for. */
  track(work: Promise<unknown>): void;
}

export const SceneContext = createContext<SceneRegistry | null>(null);

/**
 * Register a canvas painter for the lifetime of the component. The painter always sees
 * the latest props without re-registering; prop changes trigger a single repaint.
 */
export function useSceneLayer(
  z: number,
  paint: ((ctx: CanvasRenderingContext2D, frame: FrameState) => void) | null,
) {
  const scene = useContext(SceneContext);
  if (!scene) throw new Error('useSceneLayer must be used inside <ShareCard>');
  const latest = useRef(paint);
  latest.current = paint;
  const active = paint !== null;

  useLayoutEffect(() => {
    if (!active) return;
    return scene.register({ z, paint: (ctx, frame) => latest.current?.(ctx, frame) });
  }, [scene, z, active]);

  useLayoutEffect(() => scene.invalidate());
}

export function useScene() {
  const scene = useContext(SceneContext);
  if (!scene) throw new Error('useScene must be used inside <ShareCard>');
  return scene;
}
