import { describe, expect, it } from 'vitest';
import { canonicalJson, computeContentHash } from './canonical';

describe('canonicalJson & computeContentHash', () => {
  describe('canonicalJson format & determinism', () => {
    it('serializes primitives consistently', () => {
      expect(canonicalJson('hello')).toBe('"hello"');
      expect(canonicalJson(123)).toBe('123');
      expect(canonicalJson(true)).toBe('true');
      expect(canonicalJson(false)).toBe('false');
      expect(canonicalJson(null)).toBe('null');
    });

    it('sorts object keys lexicographically by Unicode code point sequence', () => {
      const input = { z: 1, a: 2, m: 3 };
      expect(canonicalJson(input)).toBe('{"a":2,"m":3,"z":1}');
    });

    it('omits undefined properties in objects and serializes undefined in arrays as null', () => {
      expect(canonicalJson({ a: 1, b: undefined, c: 2 })).toBe('{"a":1,"c":2}');
      expect(canonicalJson([1, undefined, 3])).toBe('[1,null,3]');
    });

    it('sorts astral-plane characters correctly matching RFC 8785 and Python', () => {
      // In UTF-16, 𐐷 is surrogate pair (0xD801 0xDC37), \ue000 is 0xE000.
      // Under code point / UTF-8 sorting, \ue000 (0xEE 0x80 0x80) comes BEFORE 𐐷 (0xF0 0x90 0x90 0xB7).
      const input = { '𐐷': 1, '\ue000': 2, b: 3, a: 4 };
      expect(canonicalJson(input)).toBe('{"a":4,"b":3,"\ue000":2,"𐐷":1}');
    });
  });

  describe('non-finite numbers rejection', () => {
    it('throws RangeError for top-level NaN, Infinity, -Infinity', () => {
      expect(() => canonicalJson(Number.NaN)).toThrow(RangeError);
      expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(RangeError);
      expect(() => canonicalJson(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
    });

    it('throws RangeError when non-finite numbers are nested in objects or arrays', () => {
      expect(() => canonicalJson({ score: Number.NaN })).toThrow(RangeError);
      expect(() => canonicalJson({ nested: { value: Number.POSITIVE_INFINITY } })).toThrow(RangeError);
      expect(() => canonicalJson([1, 2, Number.NEGATIVE_INFINITY])).toThrow(RangeError);
      expect(() => canonicalJson([{ items: [Number.NaN] }])).toThrow(RangeError);
    });

    it('causes computeContentHash to throw RangeError for non-finite numbers', () => {
      expect(() => computeContentHash({ bad: Number.NaN })).toThrow(RangeError);
    });
  });

  describe('computeContentHash parity with Python calculate_content_hash', () => {
    it('matches Python hash for empty object', () => {
      // Python: calculate_content_hash({})
      const hash = computeContentHash({});
      expect(hash).toBe('sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
      expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('matches Python hash for simple unordered dictionary', () => {
      // Python: calculate_content_hash({"b": 2, "a": 1})
      const hash = computeContentHash({ b: 2, a: 1 });
      expect(hash).toBe('sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
    });

    it('matches Python hash for nested dictionary with mixed types', () => {
      // Python: calculate_content_hash({"z": [3, 2, 1], "a": {"y": "hello", "x": True, "n": None}})
      const hash = computeContentHash({
        z: [3, 2, 1],
        a: { y: 'hello', x: true, n: null },
      });
      expect(hash).toBe('sha256:845f8b649ce3d089b064df597798435873fc528ab19b4c724cd6c8752eb083cc');
    });

    it('matches Python hash for unicode and astral plane characters', () => {
      // Python: calculate_content_hash({"𐐷": "test", "\ue000": "special", "tiếng_việt": "Chào bạn"})
      const hash = computeContentHash({
        '𐐷': 'test',
        '\ue000': 'special',
        tiếng_việt: 'Chào bạn',
      });
      expect(hash).toBe('sha256:dc378fb4b4c7215aed7faa754e8e3edd5532d654aa180845efc03b2357973011');
    });

    it('matches Python hash for fractional float values', () => {
      // Python: calculate_content_hash({"weight": 2.5, "factor": -0.75})
      const hash = computeContentHash({
        weight: 2.5,
        factor: -0.75,
      });
      expect(hash).toBe('sha256:cb1132dad9fb4c42151cebf734404adc89674a076184214ce09d7d90efa9813c');
    });

    it('is strictly deterministic across multiple executions', () => {
      const data = {
        schema_version: '2.0',
        definition_id: 'exp_test_01',
        questions: [{ id: 'q1', text: 'Question 1' }],
      };
      const hash1 = computeContentHash(data);
      const hash2 = computeContentHash(data);
      expect(hash1).toBe(hash2);
    });
  });
});

