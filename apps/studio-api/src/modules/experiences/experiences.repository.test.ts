import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeExperienceCursor,
  decodeReleaseCursor,
  encodeExperienceCursor,
  encodeReleaseCursor,
} from '@/modules/experiences/experiences.repository';

describe('experiences.repository cursor helpers', () => {
  it('encodes and decodes experience cursor correctly', () => {
    const original = {
      created_at: new Date('2026-10-19T10:00:00.000Z'),
      id: 'exp-123',
    };
    const encoded = encodeExperienceCursor(original);
    const decoded = decodeExperienceCursor(encoded);

    expect(decoded.created_at).toBe('2026-10-19T10:00:00.000Z');
    expect(decoded.id).toBe('exp-123');
  });

  it('rejects invalid experience cursor with 400 VAL_INVALID_REQUEST', () => {
    expect(() => decodeExperienceCursor('invalid-base64-not-json')).toThrowError(
      expect.objectContaining({
        status: 400,
        code: 'VAL_INVALID_REQUEST',
        message: 'Invalid pagination cursor',
      }),
    );

    const badJson = Buffer.from(JSON.stringify({ onlyId: '1' })).toString('base64url');
    expect(() => decodeExperienceCursor(badJson)).toThrowError(
      expect.objectContaining({
        status: 400,
        code: 'VAL_INVALID_REQUEST',
      }),
    );
  });

  it('encodes and decodes release cursor correctly', () => {
    const original = {
      published_at: new Date('2026-10-19T11:00:00.000Z'),
      id: 'rel-456',
    };
    const encoded = encodeReleaseCursor(original);
    const decoded = decodeReleaseCursor(encoded);

    expect(decoded.published_at).toBe('2026-10-19T11:00:00.000Z');
    expect(decoded.id).toBe('rel-456');
  });

  it('rejects invalid release cursor with 400 VAL_INVALID_REQUEST', () => {
    expect(() => decodeReleaseCursor('not-valid')).toThrowError(
      expect.objectContaining({
        status: 400,
        code: 'VAL_INVALID_REQUEST',
      }),
    );
  });
});

beforeEach(() => { vi.stubEnv('SECRET_KEY', 'cursor-test-secret'); });
