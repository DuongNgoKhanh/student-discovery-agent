import { describe, expect, it } from 'vitest';
import { PlaybackClock } from './clock';
import { timelineConfig as config } from './config';
import {
  beatGlow,
  facetGlow,
  haloGlow,
  scrambleGlyph,
  overlayStyle,
  phaseAt,
  sampleScene,
} from './timeline';
import { fileStem } from '../export/files';

describe('sampleScene', () => {
  it('starts dark and small, ends the reveal at full scale', () => {
    const start = sampleScene(0);
    expect(start.atmosphere).toBe(0);
    expect(start.reveal).toBe(0);
    expect(start.heroScale).toBeCloseTo(0.9);
    const revealed = sampleScene(1300);
    expect(revealed.reveal).toBe(1);
    expect(revealed.heroScale).toBeCloseTo(1);
  });

  it('reveals monotonically during phase 1', () => {
    let previous = -1;
    for (let t = 0; t <= 1300; t += 50) {
      const { reveal } = sampleScene(t);
      expect(reveal).toBeGreaterThanOrEqual(previous);
      previous = reveal;
    }
  });

  it('keeps ambient motion off until the identity is in place', () => {
    expect(sampleScene(3000).wing).toBe(0);
    const later = Array.from({ length: 40 }, (_, i) => sampleScene(5000 + i * 100).wing);
    expect(Math.max(...later)).toBeGreaterThan(0);
    expect(Math.max(...later)).toBeLessThanOrEqual(config.ambient.wingAmplitude);
  });

  it('is continuous across the end of the authored 6 s (no wrap back to the intro)', () => {
    const a = sampleScene(config.duration - 1);
    const b = sampleScene(config.duration + 1);
    expect(b.reveal).toBe(1);
    expect(Math.abs(a.float - b.float)).toBeLessThan(0.05);
    expect(Math.abs(a.wing - b.wing)).toBeLessThan(0.001);
  });

  it('reduced motion is a single still, fully revealed frame', () => {
    const a = sampleScene(0, true);
    const b = sampleScene(9999, true);
    expect(a).toEqual(b);
    expect(a.reveal).toBe(1);
    expect(a.wing).toBe(0);
    expect(a.float).toBe(0);
    expect(a.sweep).toBeNull();
  });

  it('lights facets during the aura sweep and keeps a soft glow after', () => {
    expect(facetGlow(sampleScene(1000), 0)).toBe(0);
    expect(facetGlow(sampleScene(1700), 0)).toBeGreaterThan(0.8);
    expect(facetGlow(sampleScene(4200, true), 0)).toBeGreaterThan(0.2);
  });
});

describe('haloGlow', () => {
  it('is dark before the aura, flares as the identity appears, then breathes', () => {
    expect(haloGlow(sampleScene(1000))).toBeLessThan(0.001);
    const flare = haloGlow(sampleScene(config.scene.halo.flare));
    expect(flare).toBeGreaterThan(haloGlow(sampleScene(5000)));
    expect(haloGlow(sampleScene(5000))).toBeGreaterThan(0.3);
    expect(haloGlow(sampleScene(0, true))).toBeGreaterThan(0.3);
  });
});

describe('beatGlow', () => {
  it('is silent before the ambient loop and in reduced motion', () => {
    expect(beatGlow(sampleScene(2000), 0, 4, 80)).toBe(0);
    expect(beatGlow(sampleScene(0, true), 0, 4, 80)).toBe(0);
  });

  it('flashes exactly one facet per beat, cycling through them', () => {
    const beat = 60000 / 80;
    const lit = (t: number) => [0, 1, 2, 3].filter((i) => beatGlow(sampleScene(t), i, 4, 80) > 0.5);
    const t0 = beat * 8 + 10; // start of beat 8 → facet 0
    expect(lit(t0)).toEqual([0]);
    expect(lit(t0 + beat)).toEqual([1]);
    expect(lit(t0 + beat * 4)).toEqual([0]);
  });
});

describe('title styles', () => {
  it('scramble shows random glyphs, then locks every letter by 3.3 s', () => {
    expect(scrambleGlyph(2600, 0, 10)).not.toBeNull();
    expect(scrambleGlyph(2600, 0, 10)).toBe(scrambleGlyph(2600, 0, 10)); // deterministic
    for (let i = 0; i < 10; i++) expect(scrambleGlyph(3310, i, 10)).toBeNull();
    expect(scrambleGlyph(2600, 0, 10, true)).toBeNull();
  });

  it('word style reveals whole words in order', () => {
    const at = (t: number, word: number) =>
      overlayStyle('title', t, false, word, 3, 'word').opacity;
    expect(at(2800, 0)).toBeGreaterThan(at(2800, 1));
    expect(at(3300, 2)).toBe(1);
  });

  it('beat style lands on the sixteenth-note grid', () => {
    const sixteenth = 60000 / 80 / 4;
    for (let i = 0; i < 12; i++) {
      let first = 0;
      while (overlayStyle('title', first, false, i, 12, 'beat').opacity === 0) first += 1;
      expect(first % sixteenth).toBeLessThan(1.01);
    }
  });

  it('every style is fully revealed in reduced motion', () => {
    for (const style of ['blur', 'bloom', 'scramble', 'breath', 'path', 'beat', 'word'] as const)
      expect(overlayStyle('title', 0, true, 5, 12, style).opacity).toBe(1);
  });
});

describe('overlayStyle', () => {
  it('hides identity before phase 3 and shows all of it by 3.5 s', () => {
    for (const track of ['name', 'subtitle', 'footer'] as const) {
      expect(overlayStyle(track, 2400).opacity).toBe(0);
      expect(overlayStyle(track, 3500).opacity).toBe(1);
    }
    for (let i = 0; i < 3; i++) expect(overlayStyle('chips', 3500, false, i, 3).opacity).toBe(1);
  });

  it('staggers title letters and fits long titles in the window', () => {
    const n = 28;
    expect(overlayStyle('title', 2700, false, 0, n).opacity).toBeGreaterThan(
      overlayStyle('title', 2700, false, n - 1, n).opacity,
    );
    expect(overlayStyle('title', config.overlay.title.window[1], false, n - 1, n).opacity).toBe(1);
  });

  it('settles with no offset or blur', () => {
    for (const style of ['blur', 'bloom', 'scramble', 'breath', 'path', 'beat', 'word'] as const) {
      expect(overlayStyle('title', 4000, false, 3, 10, style)).toEqual({
        opacity: 1,
        x: 0,
        y: 0,
        blur: 0,
        scale: 1,
        rotate: 0,
      });
    }
  });
});

describe('phaseAt', () => {
  it('maps times to the four phases', () => {
    expect(phaseAt(0).id).toBe('reveal');
    expect(phaseAt(1200).id).toBe('aura');
    expect(phaseAt(3000).id).toBe('identity');
    expect(phaseAt(3600).id).toBe('ambient');
    expect(phaseAt(60000).id).toBe('ambient');
  });
});

describe('PlaybackClock', () => {
  it('pauses, resumes, seeks and replays', () => {
    const clock = new PlaybackClock();
    clock.play(1000);
    expect(clock.time(1500)).toBe(500);
    clock.pause(1500);
    expect(clock.time(9000)).toBe(500);
    clock.play(9000);
    expect(clock.time(9100)).toBe(600);
    clock.seek(2500, 9100);
    expect(clock.time(9200)).toBe(2600);
    clock.seek(0, 9200);
    expect(clock.time(9200)).toBe(0);
  });
});

describe('fileStem', () => {
  it('produces ASCII file names from Vietnamese names', () => {
    expect(fileStem('Nguyễn Minh An', '9:16')).toBe('sda-aura-nguyen-minh-an-9x16');
    expect(fileStem('Đặng Thị Ánh', '4:5')).toBe('sda-aura-dang-thi-anh-4x5');
    expect(fileStem('  ', '4:5')).toBe('sda-aura-card-4x5');
  });
});
