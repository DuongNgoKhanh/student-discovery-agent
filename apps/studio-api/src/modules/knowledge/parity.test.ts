import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { knowledgeContentHash } from '@/modules/knowledge/content-hash';
import { MetadataValidationError, validateMetadata, type MetadataField } from '@/modules/knowledge/metadata';

const fixtures = resolve(__dirname, '../../../../../contracts/fixtures');
const hashes = JSON.parse(readFileSync(resolve(fixtures, 'knowledge-content-hash.json'), 'utf8')).cases as Array<{
  name: string; title: string; body: string; source_url: string | null; metadata: Record<string, unknown>; hash: string;
}>;
const metadata = JSON.parse(readFileSync(resolve(fixtures, 'knowledge-metadata-cases.json'), 'utf8')) as {
  fields: MetadataField[];
  valid: Array<{ name: string; values: Record<string, unknown>; stored: Record<string, unknown> }>;
  invalid: Array<{ name: string; values: Record<string, unknown> }>;
};

function expand(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('REPEAT_LIST:')) {
    const [, item, count] = value.split(':');
    return Array.from({ length: Number(count) }, () => item);
  }
  if (typeof value === 'string' && value.startsWith('REPEAT:')) {
    const [, item, count] = value.split(':');
    return item!.repeat(Number(count));
  }
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v)]));
  return value;
}

describe('knowledge parity with the Python writer', () => {
  it.each(hashes.map(c => [c.name, c] as const))('content hash: %s', (_name, c) => {
    expect(knowledgeContentHash(c.title, c.body, c.source_url, c.metadata)).toBe(c.hash);
  });
  it.each(metadata.valid.map(c => [c.name, c] as const))('valid metadata: %s', (_name, c) => {
    expect(validateMetadata(metadata.fields, expand(c.values) as Record<string, unknown>)).toEqual(expand(c.stored));
  });
  it.each(metadata.invalid.map(c => [c.name, c] as const))('invalid metadata: %s', (_name, c) => {
    expect(() => validateMetadata(metadata.fields, expand(c.values) as Record<string, unknown>)).toThrow(MetadataValidationError);
  });
});
