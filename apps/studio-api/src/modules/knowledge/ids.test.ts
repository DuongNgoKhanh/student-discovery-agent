import { describe, expect, it } from 'vitest';
import { prefixedDocumentIds } from '@/modules/knowledge/ids';

const take = (gen: Generator<string>, n: number) => Array.from({ length: n }, () => gen.next().value as string);

describe('prefixedDocumentIds', () => {
  it('prefixes with the KB id then counts up', () => {
    expect(take(prefixedDocumentIds('kb2', 'hiu'), 3)).toEqual(['kb2-hiu', 'kb2-hiu-2', 'kb2-hiu-3']);
  });
  it('stays within 64 characters and the id pattern', () => {
    for (const id of take(prefixedDocumentIds('kb-'.padEnd(20, 'a'), 'x'.repeat(60) + '-'), 12)) {
      expect(id.length).toBeLessThanOrEqual(64);
      expect(id).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/);
    }
  });
});
