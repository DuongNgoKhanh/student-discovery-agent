import { useId } from 'react';

/**
 * Card-style ornaments around the identity text. Each is a single-colour SVG drawn in
 * `currentColor`, so the exporter (`data-paint="svg"`) repaints it exactly as shown.
 */

/** Four-point sparkle in a 24×24 box. */
const SPARKLE = 'M12 0C12.9 8 16 11.1 24 12C16 12.9 12.9 16 12 24C11.1 16 8 12.9 0 12C8 11.1 11.1 8 12 0Z';

export function Sparkle({ size, className }: { size: number; className?: string }) {
  return (
    <span
      data-paint="svg"
      aria-hidden="true"
      className={`inline-block shrink-0 ${className ?? ''}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} className="block">
        <path d={SPARKLE} fill="currentColor" />
      </svg>
    </span>
  );
}

/** Hairline that fades out towards both ends, with a sparkle and two dots at its centre. */
export function Divider({ width, className }: { width: number; className?: string }) {
  // React ids contain characters some SVG rasterisers reject inside url(#...).
  const id = useId().replace(/[^\w-]/g, '');
  const mid = width / 2;
  return (
    <span
      data-paint="svg"
      aria-hidden="true"
      className={`block ${className ?? ''}`}
      style={{ width, height: 14 }}
    >
      <svg viewBox={`0 0 ${width} 14`} width={width} height={14} className="block">
        <defs>
          <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="currentColor" stopOpacity="0" />
            <stop offset="0.5" stopColor="currentColor" stopOpacity="0.85" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="0" y="6.6" width={mid - 14} height="0.8" fill={`url(#${id})`} />
        <rect x={mid + 14} y="6.6" width={mid - 14} height="0.8" fill={`url(#${id})`} />
        <circle cx={mid - 10} cy="7" r="1" fill="currentColor" opacity="0.8" />
        <circle cx={mid + 10} cy="7" r="1" fill="currentColor" opacity="0.8" />
        <path
          d={SPARKLE}
          fill="currentColor"
          transform={`translate(${mid - 6} 1) scale(0.5)`}
        />
      </svg>
    </span>
  );
}

/**
 * Thin orbit around the title: bright at its left and right ends, nearly gone where it
 * crosses the letters, with a sparkle on the left end and one high on the right.
 */
export function TitleRing({ width, height }: { width: number; height: number }) {
  // React ids contain characters some SVG rasterisers reject inside url(#...).
  const id = useId().replace(/[^\w-]/g, '');
  const pad = 9;
  const rx = width / 2 - pad;
  const ry = height / 2 - pad;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block">
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="0.3" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="0.5" stopColor="currentColor" stopOpacity="0.06" />
          <stop offset="0.7" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <ellipse
        cx={width / 2}
        cy={height / 2}
        rx={rx}
        ry={ry}
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth="0.9"
      />
      <path d={SPARKLE} fill="currentColor" transform={`translate(${pad - 9} ${height / 2 - 9}) scale(0.75)`} />
      <path
        d={SPARKLE}
        fill="currentColor"
        transform={`translate(${width / 2 + rx * 0.8 - 6} ${height / 2 - ry * 0.6 - 6}) scale(0.5)`}
      />
    </svg>
  );
}
