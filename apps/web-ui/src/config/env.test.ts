import { describe, it, expect } from 'vitest';
import { parseUiEnv } from './env';

describe('UI environment', () => {
  it('works without Product credentials', () => {
    expect(parseUiEnv({})).toEqual({ STUDIO_API_ORIGIN: 'http://127.0.0.1:3001' });
  });
  it('rejects an invalid API origin', () => {
    expect(() => parseUiEnv({ STUDIO_API_ORIGIN: 'invalid' })).toThrow();
  });
});
