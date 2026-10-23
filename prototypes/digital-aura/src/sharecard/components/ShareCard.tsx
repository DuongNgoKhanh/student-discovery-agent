import { frame as motionFrame, motion, useTransform, type MotionValue } from 'motion/react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react';
import { sampleScene } from '../animation/timeline';
import { brand } from '../content';
import { CARD_WIDTH, layouts } from '../layout';
import { paintBackdrop, paintChrome } from '../render/painters';
import { collectOverlay, paintOverlay } from '../render/overlay';
import { paintScene, Z, type FrameState, type SceneLayer } from '../render/scene';
import type { ArchetypeTheme, CardRatio, ShareCardData } from '../types';
import { AuraRibbons } from './AuraRibbons';
import { ButterflyHero } from './ButterflyHero';
import { CrystalShards } from './CrystalShards';
import { IdentityReveal } from './IdentityReveal';
import { ParticleField } from './ParticleField';
import { SceneContext, useSceneLayer, type SceneRegistry } from './scene-context';
import { TitleStyleContext, trackProps, useOverlayMotion } from './overlay-motion';
import { timelineConfig } from '../animation/config';

export interface ShareCardProps {
  data: ShareCardData;
  theme: ArchetypeTheme;
  ratio: CardRatio;
  /** Playback position in ms; owned by the animation controller. */
  time: MotionValue<number>;
  reduced: boolean;
  /** Smoothed pointer, -1..1. Omit for no parallax. */
  pointer?: { x: MotionValue<number>; y: MotionValue<number> };
  /** Rendered width in CSS pixels. The card is authored at 400 units and scaled. */
  displayWidth: number;
  onArtworkError?: (message: string) => void;
  /** The hero artwork is ready: start (or restart) the reveal now, not before. */
  onHeroReady?: () => void;
}

/** Paints one complete card frame (scene + typography) into any 2D context. */
export interface CardFrameRenderer {
  width: number;
  height: number;
  /** `ctx` must already be scaled so one unit = `canvas.width / width` pixels. */
  paint(ctx: CanvasRenderingContext2D, time: number, options?: { reduced?: boolean }): void;
}

export interface ShareCardHandle {
  /** Waits for fonts and artwork, snapshots the layout, and returns a renderer for export. */
  createRenderer(): Promise<CardFrameRenderer>;
}

const MAX_DPR = 2;

export const ShareCard = forwardRef<ShareCardHandle, ShareCardProps>(function ShareCard(
  { data, theme, ratio, time, reduced, pointer, displayWidth, onArtworkError, onHeroReady },
  ref,
) {
  const layout = layouts[ratio];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const layers = useRef<SceneLayer[]>([]);
  const pending = useRef(new Set<Promise<unknown>>());
  const scheduled = useRef(false);

  const frameState = useCallback(
    (t: number, isReduced: boolean, px = 0, py = 0): FrameState => ({
      sample: sampleScene(
        t,
        isReduced,
        theme.motion?.pulsePeriod
          ? {
              ...timelineConfig,
              ambient: { ...timelineConfig.ambient, pulsePeriod: theme.motion.pulsePeriod },
            }
          : timelineConfig,
      ),
      layout,
      theme,
      pointer: { x: px, y: py },
    }),
    [layout, theme],
  );

  // Latest inputs for the paint callback, so scheduling never needs to re-subscribe.
  const live = useRef({ frameState, reduced, pointer });
  live.current = { frameState, reduced, pointer };

  const paintNow = useCallback(() => {
    scheduled.current = false;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { frameState: build, reduced: isReduced, pointer: p } = live.current;
    const state = build(time.get(), isReduced, p?.x.get() ?? 0, p?.y.get() ?? 0);
    paintScene(ctx, layers.current, state, canvas.width / CARD_WIDTH);
  }, [time]);

  // Coalesce every request in a frame into one paint, in Motion's render step so the
  // canvas and the Motion-driven DOM overlay update in the same frame.
  const invalidate = useCallback(() => {
    if (scheduled.current) return;
    scheduled.current = true;
    motionFrame.render(paintNow);
  }, [paintNow]);

  const registry = useMemo<SceneRegistry>(
    () => ({
      register(layer) {
        layers.current = [...layers.current, layer];
        invalidate();
        return () => {
          layers.current = layers.current.filter((l) => l !== layer);
          invalidate();
        };
      },
      invalidate,
      track(work) {
        pending.current.add(work);
        const done = () => pending.current.delete(work);
        work.then(done, done);
      },
    }),
    [invalidate],
  );

  useEffect(() => {
    const unsubscribe = [time.on('change', invalidate)];
    if (pointer)
      unsubscribe.push(pointer.x.on('change', invalidate), pointer.y.on('change', invalidate));
    return () => unsubscribe.forEach((u) => u());
  }, [time, pointer, invalidate]);

  // Backing store follows the displayed size and device pixel ratio.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round((displayWidth * dpr * layout.height) / CARD_WIDTH);
    invalidate();
  }, [displayWidth, layout.height, invalidate]);

  useLayoutEffect(() => invalidate(), [reduced, theme, layout, invalidate]);

  useImperativeHandle(
    ref,
    () => ({
      async createRenderer() {
        await document.fonts.ready;
        await Promise.allSettled([...pending.current]);
        // Let pending React commits (e.g. a just-decoded artwork layer) land.
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const overlay = overlayRef.current;
        if (!overlay) throw new Error('Card is not mounted.');
        const nodes = await collectOverlay(overlay);
        const snapshot = [...layers.current];
        return {
          width: CARD_WIDTH,
          height: layout.height,
          paint(ctx, t, options) {
            const unit = ctx.canvas.width / CARD_WIDTH;
            paintScene(ctx, snapshot, frameState(t, options?.reduced ?? false), unit);
            ctx.save();
            ctx.setTransform(unit, 0, 0, unit, 0, 0);
            paintOverlay(ctx, nodes, t, options?.reduced ?? false, theme.motion?.title ?? 'blur');
            ctx.restore();
          },
        };
      },
    }),
    [frameState, layout.height, theme.motion?.title],
  );

  const rotateX = useTransform(pointer?.y ?? time, (v) => (pointer ? -v * 5 : 0));
  const rotateY = useTransform(pointer?.x ?? time, (v) => (pointer ? v * 6 : 0));
  const scale = displayWidth / CARD_WIDTH;
  const cssVars = {
    '--card-text': theme.palette.text,
    '--card-lavender': theme.palette.lavender,
    '--card-muted': theme.palette.muted,
    '--card-subtle': theme.palette.lavender + 'cc',
    '--card-chip': theme.palette.chip,
    '--card-chip-border': theme.palette.chipBorder,
    '--card-rule': theme.palette.lavender + '40',
    '--card-glow': theme.palette.accent + 'b0',
    '--card-shadow': (theme.palette.glow ?? '#5949d3') + '99',
    '--card-halo': (theme.palette.glow ?? '#8b5cf6') + '33',
  } as CSSProperties;

  return (
    <SceneContext.Provider value={registry}>
      <TitleStyleContext.Provider value={theme.motion?.title ?? 'blur'}>
        <div
          role="group"
          aria-roledescription="ShareCard"
          aria-label={`${data.name} — ${data.archetype.title} (${data.archetype.subtitle})`}
          style={{ width: displayWidth, height: displayWidth * (layout.height / CARD_WIDTH) }}
          className="relative"
        >
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{
              width: CARD_WIDTH,
              height: layout.height,
              transform: `scale(${scale})`,
              ...cssVars,
            }}
          >
            <motion.div
              style={{ rotateX, rotateY, transformPerspective: 1100 }}
              className="absolute inset-0 overflow-hidden rounded-[28px] bg-[#0a0a20] shadow-[0_30px_90px_-20px_var(--card-shadow),0_0_60px_var(--card-halo)]"
            >
              <canvas
                ref={canvasRef}
                aria-hidden="true"
                className="absolute inset-0 block"
                style={{ width: CARD_WIDTH, height: layout.height }}
              />
              <div ref={overlayRef} className="absolute inset-0 select-none">
                <CardHeader time={time} top={layout.header.top} />
                <IdentityReveal data={data} layout={layout} time={time} />
              </div>
            </motion.div>
          </div>

          <Backdrop />
          <ParticleField
            layer="far"
            height={layout.height}
            colors={theme.palette.particles}
            count={72}
          />
          <AuraRibbons />
          <CrystalShards />
          <ButterflyHero artwork={theme.artwork} onError={onArtworkError} onReady={onHeroReady} />
          <ParticleField
            layer="near"
            height={layout.height}
            colors={theme.palette.particles}
            count={72}
          />
          <Chrome />
        </div>
      </TitleStyleContext.Provider>
    </SceneContext.Provider>
  );
});

function Backdrop() {
  useSceneLayer(Z.backdrop, paintBackdrop);
  return null;
}

function Chrome() {
  useSceneLayer(Z.chrome, paintChrome);
  return null;
}

/** Wide enough that the two descriptor lines stay legible (~15 px each at 1080 px export). */
const LOGO_WIDTH = 84;

function CardHeader({ time, top }: { time: MotionValue<number>; top: number }) {
  const style = useOverlayMotion(time, 'header');
  return (
    <motion.div
      {...trackProps('header')}
      style={{ ...style, paddingTop: top }}
      className="absolute inset-x-0 top-0 flex items-center justify-between px-[28px]"
    >
      <img
        data-paint="img"
        src={brand.logo.src}
        alt={brand.logo.alt}
        draggable={false}
        style={{ width: LOGO_WIDTH, height: LOGO_WIDTH / brand.logo.aspect }}
        className="block"
      />
      <span
        data-paint="text"
        className="inline-block font-sans text-[10.5px] leading-[20px] tracking-[0.26em] text-[var(--card-lavender)] uppercase"
      >
        {brand.label}
      </span>
    </motion.div>
  );
}
