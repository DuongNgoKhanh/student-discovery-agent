import { useTransform, type MotionValue } from 'motion/react';
import { createContext, useContext, useLayoutEffect, type RefObject } from 'react';
import { overlayStyle, type OverlayTrack, type TitleStyle } from '../animation/timeline';

/** The card's title style, provided by <ShareCard> from the archetype theme. */
export const TitleStyleContext = createContext<TitleStyle>('blur');

/**
 * Motion values for one overlay element. Motion writes them straight to the DOM when the
 * shared `time` value changes, so playback never re-renders React.
 */
export function useOverlayMotion(
  time: MotionValue<number>,
  track: OverlayTrack,
  index = 0,
  count = 1,
) {
  const style = useContext(TitleStyleContext);
  const at = (t: number) => overlayStyle(track, t, false, index, count, style);
  const opacity = useTransform(time, (t) => at(t).opacity);
  const x = useTransform(time, (t) => at(t).x);
  const y = useTransform(time, (t) => at(t).y);
  const scale = useTransform(time, (t) => at(t).scale);
  const rotate = useTransform(time, (t) => at(t).rotate);
  const filter = useTransform(time, (t) => {
    const blur = at(t).blur;
    return blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : 'none';
  });
  return { opacity, x, y, scale, rotate, filter };
}

/** Attributes the exporter uses to replay an element's animation on canvas. */
export const trackProps = (track: OverlayTrack, index = 0, count = 1) => ({
  'data-track': track,
  'data-index': index,
  'data-count': count,
});

/**
 * Shrink a single-line element's font size until it fits `maxWidth` (card units), never below
 * `min`. Runs only when content or fonts change, outside the animation loop.
 */
export function useFitText(
  ref: RefObject<HTMLElement | null>,
  deps: readonly unknown[],
  { max, min, maxWidth }: { max: number; min: number; maxWidth: number },
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = `${max}px`;
      const natural = el.offsetWidth;
      if (natural > maxWidth) el.style.fontSize = `${Math.max(min, (max * maxWidth) / natural)}px`;
    };
    fit();
    let live = true;
    void document.fonts?.ready.then(() => live && fit());
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [max, min, maxWidth, ...deps]);
}
