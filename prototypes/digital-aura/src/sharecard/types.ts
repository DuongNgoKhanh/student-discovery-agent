import type { TitleStyle } from './animation/timeline';

/**
 * Public contracts for the ShareCard. Content (`ShareCardData`), appearance
 * (`ArchetypeTheme`) and motion (`TimelineConfig`, see animation/config.ts) are
 * deliberately separate so new SDA archetypes only supply data, never code.
 */

export type CardRatio = '9:16' | '4:5';

/** Known SDA archetypes. Extend this union when a new archetype ships. */
export type ArchetypeId =
  'creator' | 'decoder' | 'healer' | 'leader' | 'temper' | 'storyteller' | (string & {});

/** Line icons available to strength chips (rendered as SVG, exported as SVG). */
export type StrengthIcon =
  | 'brain'
  | 'search'
  | 'target'
  | 'sparkles'
  | 'lightbulb'
  | 'compass'
  | 'leaf'
  | 'waves'
  | 'heart'
  | 'eye'
  | 'user'
  | 'users';

export interface Strength {
  label: string;
  /** Short typographic ornament shown before the label, e.g. "✦". Decorative only. */
  glyph?: string;
  /** Line icon shown before the label. Takes precedence over `glyph`. */
  icon?: StrengthIcon;
}

/** Everything that is about the person and their result. Editable in the studio. */
export interface ShareCardData {
  name: string;
  archetype: {
    id: ArchetypeId;
    /** Localised archetype name, the card's display headline. */
    title: string;
    /** Secondary (English) name. */
    subtitle: string;
    /** Collection marker such as "04/06". Optional. */
    edition?: string;
  };
  strengths: readonly Strength[];
  tagline: string;
  /**
   * Fields the archetype thrives in, e.g. ["Công nghệ", "Khoa học"]. When present they
   * replace the tagline in the card footer.
   */
  fields?: readonly string[];
}

/** Normalised point inside the artwork image: 0..1 on both axes. */
export interface ArtPoint {
  x: number;
  y: number;
}

/** Elliptical area of the artwork to erase (baked-in text, watermarks...). */
export interface ArtErase {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface ArtworkAsset {
  src: string;
  alt: string;
  /** Where the asset came from; surfaced in the studio so fidelity claims stay honest. */
  provenance: string;
  /** Centre of the creature (reveal origin, glow centre). */
  focal: ArtPoint;
  /**
   * Body axis (head → tail). Wing motion foreshortens the artwork perpendicular to
   * this line, which reads as wings rotating about the body. Omit to disable.
   */
  bodyAxis?: readonly [ArtPoint, ArtPoint];
  /** Crystal facets that emit light during the aura sweep and pulse in the loop. */
  facets: readonly (ArtPoint & { size: number })[];
  /** Regions faded out when the artwork is prepared. */
  erase: readonly ArtErase[];
  /** Feathered edge mask, as fractions of the artwork size. */
  feather: { top: number; bottom: number; side: number };
  /**
   * `contain` (default) fits the whole image inside the layout square. `width` fills the
   * square's width and aligns to its top, letting a portrait image run down behind the title.
   */
  fit?: 'contain' | 'width';
  /** Height / width of the image (default 1). Lets motifs place art points without decoding it. */
  aspect?: number;
  /** Glowing halo ring (with rays) that flares in the identity phase, then breathes. */
  halo?: ArtPoint & {
    /** Radius as a fraction of the artwork width. */
    radius: number;
    /** Draw turning light rays around the ring (default true). Off reads as a soft moon glow. */
    rays?: boolean;
  };
  /** Water ripples spreading from a point; radii as fractions of the artwork width. */
  ripples?: ArtPoint & { rx: number; ry: number };
  /** Known resolution concern shown in the studio, if any. */
  qualityNote?: string;
}

export interface RibbonSpec {
  /** Radii in card units around the artwork focal point. */
  rx: number;
  ry: number;
  /** Ellipse tilt in degrees. */
  tilt: number;
  /** Colours along the ribbon, head to tail. */
  colors: readonly string[];
  width: number;
  /** Orbit speed in radians per second. Negative orbits counter-clockwise. */
  speed: number;
  /** Starting angle in radians. */
  phase: number;
  /** Length of the visible trail in radians. */
  length: number;
  /** Shift the orbit centre down (card units) so it circles the body, not the face. */
  offsetY?: number;
}

/** A floating crystal shard around the hero (the "crystal pulse" motif). */
export interface ShardSpec {
  /** Offset from the artwork focal point, in card units (scaled with the hero). */
  dx: number;
  dy: number;
  /** Half-height in card units. */
  size: number;
  /** Behind the artwork, or floating in front of it with stronger parallax. */
  depth: 'back' | 'front';
  /** Spin speed in radians per second; tilt in degrees. */
  spin: number;
  tilt: number;
  phase: number;
}

/** How the hero artwork is revealed in phase 1. */
export type RevealStyle =
  | 'radial' // light opens from the focal point (default)
  | 'unfold' // opens outward from the body axis while the wings unfold
  | 'scan' // a scanline sweeps down over a fading grid
  | 'rise' // light rises from the water at the bottom
  | 'dawn' // the sun appears first, then light climbs from the horizon
  | 'droplet' // a droplet falls; the image opens behind an expanding wave ring
  | 'ink'; // spreads like ink from the left with an ember edge

/** Opening particles (phase 1). `converge` is the shared default. */
export type IntroStyle =
  | 'converge' // motes spiral into the hero
  | 'pollen' // sparkles fly a figure-eight, then gather into the body
  | 'datarain' // columns of 0/1 fall like a data stream
  | 'fireflies' // motes rise from the water
  | 'sunrays' // light streaks converge into the sun
  | 'bubbles' // bubbles surge up in beat-timed bursts
  | 'embers'; // sparks lift off the spreading ink

/** The moving aura from phase 2 onward. `orbit` (elliptical ribbons) is the shared default. */
export type AuraStyle =
  | 'orbit'
  | 'flight' // comet trails on figure-eight flight paths
  | 'cipher' // HUD-like dashed rings counter-rotating around the head
  | 'helix' // a double spiral rising from the water
  | 'path' // a winding road of light leading to the sun
  | 'waves' // sound-wave ribbons that swell on the beat
  | 'threads'; // calligraphic strokes that write themselves, then lift away

export interface ArchetypeMotion {
  intro?: IntroStyle;
  aura?: AuraStyle;
  reveal?: RevealStyle;
  /** Identity typography style (see TitleStyle in animation/timeline.ts). */
  title?: TitleStyle;
  /** Period of the ambient light pulse in ms (default 3000). The Healer breathes slower. */
  pulsePeriod?: number;
  /** Every few seconds a thin light sweeps across the first facet (the eye). */
  eyeScan?: boolean;
  /** The halo flickers gently like a lantern. */
  flicker?: boolean;
}

export interface ArchetypeTheme {
  id: ArchetypeId;
  artwork: ArtworkAsset;
  palette: {
    /** Card atmosphere, centre to edge. */
    backdrop: readonly [string, string, string];
    /** Solid colour behind the identity block. */
    veil: string;
    accent: string;
    lavender: string;
    blue: string;
    text: string;
    muted: string;
    chip: string;
    chipBorder: string;
    frame: readonly string[];
    particles: readonly string[];
    /** Outer glow around the card in the studio (#rrggbb). Defaults to violet. */
    glow?: string;
  };
  ribbons: readonly RibbonSpec[];
  shards?: readonly ShardSpec[];
  /** How mid/near particles are drawn: glowing motes (default), rising bubbles, or falling petals. */
  particleShape?: 'glow' | 'bubble' | 'petal';
  /** Crystal facets flash one after another on a beat during the ambient loop. */
  rhythm?: { bpm: number };
  /** Per-archetype motion signature. Omitted fields use the shared defaults. */
  motion?: ArchetypeMotion;
}
