import { motion, useTransform, type MotionValue } from 'motion/react';
import { useContext, useMemo, useRef } from 'react';
import { scrambleGlyph } from '../animation/timeline';
import type { RatioLayout } from '../layout';
import type { ShareCardData } from '../types';
import { TitleStyleContext, trackProps, useFitText, useOverlayMotion } from './overlay-motion';
import { StrengthChips } from './StrengthChips';

interface IdentityRevealProps {
  data: ShareCardData;
  layout: RatioLayout;
  time: MotionValue<number>;
}

const CONTENT_WIDTH = 344;

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
  const name = useOverlayMotion(time, 'name');
  const subtitle = useOverlayMotion(time, 'subtitle');
  const footer = useOverlayMotion(time, 'footer');
  const fields = (data.fields ?? []).map((f) => f.trim()).filter(Boolean);
  const titleStyle = useContext(TitleStyleContext);
  const letters = useMemo(() => graphemes(data.archetype.title), [data.archetype.title]);

  const words = useMemo(() => wordIndices(letters), [letters]);

  useFitText(nameRef, [data.name], { max: 12.5, min: 9, maxWidth: CONTENT_WIDTH });
  useFitText(titleRef, [data.archetype.title], { ...layout.title, maxWidth: CONTENT_WIDTH });

  const subtitleText = [data.archetype.subtitle, data.archetype.edition]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      style={{ paddingBottom: layout.identity.bottom }}
      className="absolute inset-x-0 bottom-0 flex flex-col items-center px-7"
    >
      <motion.span {...trackProps('name')} style={name} className="block">
        <span
          ref={nameRef}
          data-paint="text"
          className="inline-block font-sans leading-[18px] font-semibold tracking-[0.28em] whitespace-nowrap text-[var(--card-lavender)] uppercase"
        >
          {data.name}
        </span>
      </motion.span>

      <h2 className={compact ? 'mt-1' : 'mt-2'} aria-label={data.archetype.title}>
        <span
          ref={titleRef}
          key={data.archetype.title}
          aria-hidden="true"
          className="font-display inline-block leading-[1.12] font-semibold whitespace-nowrap text-[var(--card-text)] [text-shadow:0_0_18px_var(--card-glow)]"
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

      <motion.span {...trackProps('subtitle')} style={subtitle} className="mt-[2px] block">
        <span
          data-paint="text"
          className="inline-block font-sans text-[11px] leading-[16px] tracking-[0.32em] whitespace-nowrap text-[var(--card-subtle)] uppercase"
        >
          {subtitleText}
        </span>
      </motion.span>

      <div className={`w-full ${compact ? 'mt-4' : 'mt-6'}`}>
        <StrengthChips strengths={data.strengths} time={time} />
      </div>

      <motion.div
        {...trackProps('footer')}
        style={footer}
        className={`flex w-full flex-col items-center ${compact ? 'mt-3' : 'mt-5'}`}
      >
        {fields.length ? (
          <>
            <div className="flex w-full items-center gap-2.5">
              <div data-paint="box" className="h-px flex-1 bg-[var(--card-rule)]" />
              <span
                data-paint="text"
                aria-hidden="true"
                className="inline-block text-[11px] leading-[12px] text-[var(--card-lavender)]"
              >
                ✦
              </span>
              <div data-paint="box" className="h-px flex-1 bg-[var(--card-rule)]" />
            </div>
            <span
              data-paint="text"
              className={`inline-block font-sans text-[10.5px] leading-[16px] font-semibold tracking-[0.26em] whitespace-nowrap text-[var(--card-subtle)] uppercase ${compact ? 'mt-2' : 'mt-3'}`}
            >
              {fields.join(' · ')}
            </span>
          </>
        ) : (
          <>
            <div data-paint="box" className="h-px w-full bg-[var(--card-rule)]" />
            <span
              data-paint="text"
              className={`inline-block font-sans text-[12px] leading-[16px] whitespace-nowrap text-[var(--card-muted)] ${compact ? 'mt-2.5' : 'mt-3.5'}`}
            >
              {data.tagline}
            </span>
          </>
        )}
      </motion.div>
    </div>
  );
}

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
      <motion.span data-paint="text" style={{ opacity: real }} className="inline-block">
        {blank ? '\u00a0' : letter}
      </motion.span>
      {scramble && !blank && (
        <motion.span aria-hidden="true" className="absolute inset-0 text-center">
          {glyph}
        </motion.span>
      )}
    </motion.span>
  );
}
