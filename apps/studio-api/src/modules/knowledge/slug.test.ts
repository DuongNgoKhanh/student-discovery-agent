import { describe, expect, it } from 'vitest';
import { documentIdFromFilename, slugify } from '@/modules/knowledge/slug';

describe('slug', () => {
  it('strips Vietnamese marks and đ', () => {
    expect(slugify('Trường Đại học Công nghệ — HUTECH')).toBe('truong-dai-hoc-cong-nghe-hutech');
  });
  it('drops leading/trailing separators and caps the length', () => {
    expect(slugify('  --Học phí!!  ')).toBe('hoc-phi');
    expect(slugify('a'.repeat(200))).toHaveLength(128);
    expect(slugify('ab-'.repeat(60), 10)).toBe('ab-ab-ab-a');
  });
  it('keeps file names that are already slugs', () => {
    expect(documentIdFromFilename('tuyen-sinh-hutech.md')).toBe('tuyen-sinh-hutech');
    expect(documentIdFromFilename('Ghi chú.TXT')).toBe('ghi-chu');
    expect(documentIdFromFilename('.md')).toBe('');
  });
});
