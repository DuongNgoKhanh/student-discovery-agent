import { motion, useTransform, type MotionValue } from 'motion/react';
import { useContext, useMemo, useRef } from 'react';
import { scrambleGlyph } from '../animation/timeline';
import type { RatioLayout } from '../layout';
import type { ShareCardData } from '../types';
import { TitleStyleContext, trackProps, useFitText, useOverlayMotion } from './overlay-motion';
import { Divider, TitleRing } from './ornaments';
import { StrengthChips } from './strength-chips';

interface IdentityRevealProps {
  data: ShareCardData;
  layout: RatioLayout;
  time: MotionValue<number>;
}

const CONTENT_WIDTH = 344;
/**
 * Title fill: white fading to the theme's pale tint, with a soft glow. The glow is a drop-shadow,
 * not a text-shadow, which would paint over the gradient-clipped glyphs. The exporter reads both
 * the gradient and the drop-shadow from the computed style.
 */
const TITLE_INK =
  'bg-[linear-gradient(180deg,#ffffff_35%,var(--card-title-low)_100%)] bg-clip-text text-transparent [filter:drop-shadow(0_0_12px_var(--card-glow))]';
/** Keeps long titles inside the frame drawn into every artwork (~45 units from each edge). */
const TITLE_WIDTH = 300;

const graphemes = (text: string) =>
  typeof Intl.Segmenter === 'function'
    ? Array.from(
        new Intl.Segmenter('vi', { granularity: 'grapheme' }).segment(text),
        (s) => s.segment,
      )
    : Array.from(text);

/** Name, staggered archetype title, subtitle, strengths and tagline. */
export function IdentityReveal({ data, layout, time }: IdentityRevealProps) {
  const compact = layout.ratio === '4:5';
  const nameRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const subtitleRef = useRef<HTMLSpanElement>(null);
  const footerRef = useRef<HTMLSpanElement>(null);
  const name = useOverlayMotion(time, 'name');
  const subtitle = useOverlayMotion(time, 'subtitle');
  const footer = useOverlayMotion(time, 'footer');
  // The chip backing fades in with the chips, not before them.
  const chipZone = useOverlayMotion(time, 'chips');
  const fields = (data.fields ?? []).map((f) => f.trim()).filter(Boolean);
  const titleStyle = useContext(TitleStyleContext);
  const letters = useMemo(() => graphemes(data.archetype.title), [data.archetype.title]);

  const words = useMemo(() => wordIndices(letters), [letters]);

  useFitText(nameRef, [data.name], { max: compact ? 14 : 15.5, min: 10, maxWidth: CONTENT_WIDTH });
  useFitText(titleRef, [data.archetype.title], { ...layout.title, maxWidth: TITLE_WIDTH });
  // Subtitle and footer shrink to fit the card width, so long lines never run past the frame.
  useFitText(subtitleRef, [data.archetype.subtitle, data.archetype.edition], {
    max: 10,
    min: 7,
    maxWidth: CONTENT_WIDTH,
  });
  useFitText(footerRef, [fields.join('|'), data.tagline], {
    max: 12,
    min: 8,
    maxWidth: CONTENT_WIDTH,
  });

  const subtitleText = [data.archetype.subtitle, data.archetype.edition]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      style={{
        paddingBottom: layout.identity.bottom,
        transform: `translateX(${layout.identity.offsetX ?? 0}px)`,
      }}
      className="absolute inset-x-0 bottom-0 flex flex-col items-center px-7"
    >
      <motion.div {...trackProps('name')} style={name} className="flex flex-col items-center">
        <span
          ref={nameRef}
          data-paint="text"
          className="inline-block whitespace-nowrap font-card font-light leading-[22px] tracking-[0.04em] text-[var(--card-text)] [text-shadow:0_0_10px_var(--card-ink)]"
        >
          {data.name}
        </span>
        <Divider width={compact ? 150 : 180} className="mt-1 text-[var(--card-ornament)]" />
      </motion.div>

      {/* The ring sits behind the title and subtitle; it is painted first, so it stays underneath. */}
      <div className="relative flex flex-col items-center">
        <motion.span
          {...trackProps('subtitle')}
          // Centred on the title block with margins, not a transform, so export offsets stay exact.
          style={{ ...subtitle, ...ringBox(compact) }}
          data-paint="svg"
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 block text-[var(--card-lavender)]"
        >
          <TitleRing {...ringSize(compact)} />
        </motion.span>

        <h2 className={compact ? 'mt-0' : 'mt-0.5'} aria-label={data.archetype.title}>
          <span
            ref={titleRef}
            key={data.archetype.title}
            aria-hidden="true"
            className="inline-block whitespace-nowrap font-card-title font-medium leading-[1.18]"
          >
            {letters.map((letter, i) => {
              // The `word` style staggers whole words: letters share their word's slot.
              const [index, count] =
                titleStyle === 'word' ? [words.indexOf[i]!, words.count] : [i, letters.length];
              return (
                <Letter
                  key={i}
                  letter={letter}
                  index={index}
                  count={count}
                  time={time}
                  scramble={titleStyle === 'scramble'}
                />
              );
            })}
          </span>
        </h2>

        <motion.span {...trackProps('subtitle')} style={subtitle} className="block">
          {/* The negative margin cancels the tracking after the last letter, so the line centres. */}
          <span
            ref={subtitleRef}
            data-paint="text"
            className="mr-[-0.6em] inline-block whitespace-nowrap font-card text-[10px] font-light uppercase leading-[16px] tracking-[0.6em] text-[var(--card-subtle)]"
          >
            {subtitleText}
          </span>
        </motion.span>
      </div>

      {/* Chips and footer move up by `identity.lift` without shifting the name and title. */}
      <div
        style={{ transform: `translateY(${-(layout.identity.lift ?? 0)}px)` }}
        className="flex flex-col items-center"
      >
        <motion.div
          {...trackProps('chips')}
          style={chipZone}
          className={`flex flex-col items-center ${compact ? 'mt-2' : 'mt-4'}`}
        >
          <Divider width={compact ? 150 : 180} className="text-[var(--card-ornament)]" />
          {/* 324 wide: sits inside the frame, which is inset 26 from each card edge. */}
          <div
            data-paint="box"
            className={`mt-1 w-[324px] rounded-full border border-[rgba(255,255,255,0.18)] bg-[var(--card-glass)] px-2 ${compact ? 'py-1.5' : 'py-2'}`}
          >
            <StrengthChips strengths={data.strengths} time={time} />
          </div>
        </motion.div>

        <motion.div
          {...trackProps('footer')}
          style={footer}
          className={`flex w-full flex-col items-center ${compact ? 'mt-2.5' : 'mt-4'}`}
        >
          {fields.length ? (
            <span
              ref={footerRef}
              data-paint="text"
              className="inline-block whitespace-pre font-card text-[12px] font-normal leading-[16px] tracking-[0.02em] text-[var(--card-lavender)] [text-shadow:0_0_8px_var(--card-ink)]"
            >
              {fields.join('   ·   ')}
            </span>
          ) : (
            <span
              data-paint="text"
              className="inline-block whitespace-nowrap font-card text-[12px] font-light leading-[16px] text-[var(--card-muted)]"
            >
              {data.tagline}
            </span>
          )}
        </motion.div>
      </div>
    </div>
  );
}

/** Orbit around the title block, wider than the title so its ends clear the letters. */
const ringSize = (compact: boolean) =>
  compact ? { width: 352, height: 84 } : { width: 372, height: 100 };

const ringBox = (compact: boolean) => {
  const { width, height } = ringSize(compact);
  return { width, height, marginLeft: -width / 2, marginTop: -height / 2 + 4 };
};

/** Word index for every grapheme (spaces belong to the preceding word) and the word count. */
function wordIndices(letters: readonly string[]) {
  const indexOf: number[] = [];
  let word = 0;
  letters.forEach((letter, i) => {
    if (letter.trim() && i > 0 && !letters[i - 1]!.trim()) word++;
    indexOf.push(word);
  });
  return { indexOf, count: word + 1 };
}

function Letter({
  letter,
  index,
  count,
  time,
  scramble,
}: {
  letter: string;
  index: number;
  count: number;
  time: MotionValue<number>;
  scramble: boolean;
}) {
  const style = useOverlayMotion(time, 'title', index, count);
  const blank = letter.trim() === '';
  const glyph = useTransform(time, (t) =>
    scramble && !blank ? (scrambleGlyph(t, index, count) ?? '') : '',
  );
  const real = useTransform(glyph, (g) => (g ? 0 : 1));
  return (
    <motion.span
      {...trackProps('title', index, count)}
      style={style}
      className="relative inline-block"
    >
      {/* The real letter always holds the width, so scrambling never shifts the line. */}
      <motion.span
        data-paint="text"
        style={{ opacity: real }}
        className={`${TITLE_INK} inline-block`}
      >
        {blank ? '\u00a0' : letter}
      </motion.span>
      {scramble && !blank && (
        <motion.span aria-hidden="true" className={`${TITLE_INK} absolute inset-0 text-center`}>
          {glyph}
        </motion.span>
      )}
    </motion.span>
  );
}
