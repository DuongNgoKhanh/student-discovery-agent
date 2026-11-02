import { describe, expect, it } from 'vitest';
import { exportSizes, layouts } from './layout';

describe('layouts', () => {
  it('keeps the 9:16 identity block inside the Story-safe band (~14% top and bottom)', () => {
    const l = layouts['9:16'];
    const safe = l.safe!;
    expect(safe.top / l.height).toBeGreaterThanOrEqual(0.135);
    expect(1 - safe.bottom / l.height).toBeGreaterThanOrEqual(0.135);
    expect(l.height - l.identity.bottom).toBeLessThanOrEqual(safe.bottom);
  });

  it('places the 9:16 brand header above the safe band by design', () => {
    // Product decision (2026-10-23): the IHRD header sits near the top of the card, accepting
    // that Story UI may overlap it. Move it to `safe.top` if Stories must show the logo.
    const l = layouts['9:16'];
    expect(l.header.top).toBeLessThan(l.safe!.top);
  });

  it('matches the export aspect ratios', () => {
    for (const ratio of ['9:16', '4:5'] as const) {
      const { width, height } = exportSizes[ratio];
      expect(layouts[ratio].height / 400).toBeCloseTo(height / width, 2);
    }
  });
});
