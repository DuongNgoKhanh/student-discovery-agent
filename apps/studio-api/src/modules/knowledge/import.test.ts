import { describe, expect, it } from 'vitest';
import { firstHeading, ImportInputError, MAX_IMPORT_ROWS, parseCsv, parseCsvRows, parseFiles } from '@/modules/knowledge/import';

const FIELDS = [
  { name: 'province', type: 'string' as const },
  { name: 'fee', type: 'number' as const },
  { name: 'houses', type: 'string_list' as const },
];

describe('parseCsv', () => {
  it('handles BOM, CRLF, quoted commas, doubled quotes and multi-line cells', () => {
    const text = '﻿id,title,body\r\nhutech,"HUTECH, TP.HCM","Dòng 1\r\nDòng ""2"""\r\n\r\nptit,PTIT,x\n';
    expect(parseCsv(text)).toEqual([
      ['id', 'title', 'body'],
      ['hutech', 'HUTECH, TP.HCM', 'Dòng 1\r\nDòng "2"'],
      ['ptit', 'PTIT', 'x'],
    ]);
  });
  it('rejects an unterminated quote', () => {
    expect(() => parseCsv('a,"b\nc')).toThrow(ImportInputError);
  });
});

describe('parseFiles', () => {
  it('uses the file name as id and the first H1 as title', () => {
    const [row] = parseFiles([{ name: 'tuyen-sinh-hutech.md', content: '﻿Intro\n\n# HUTECH — Tuyển sinh #\n\n## Học phí' }]);
    expect(row).toMatchObject({ row: 1, source: 'tuyen-sinh-hutech.md', documentId: 'tuyen-sinh-hutech', title: 'HUTECH — Tuyển sinh', errors: [] });
    expect(row!.body!.startsWith('Intro')).toBe(true);
    expect(row!.sourceUrl).toBeUndefined();
    expect(row!.metadata).toEqual({});
  });
  it('falls back to the file name and flags unsupported files', () => {
    const [plain, pdf] = parseFiles([{ name: 'Ghi chú.txt', content: 'không có heading' }, { name: 'a.pdf', content: 'x' }]);
    expect(plain).toMatchObject({ documentId: 'ghi-chu', title: 'Ghi chú', errors: [] });
    expect(pdf!.errors).toHaveLength(1);
  });
  it('ignores H2 when looking for the title', () => {
    expect(firstHeading('## Không phải\n# Đây')).toBe('Đây');
    expect(firstHeading('không có')).toBeNull();
  });
  it('caps the number of files', () => {
    const files = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ name: `f${i}.md`, content: 'x' }));
    expect(() => parseFiles(files)).toThrow(ImportInputError);
  });
});

describe('parseCsvRows', () => {
  const csv = 'Mã,Tên,Tỉnh,Học phí,Hệ\nhutech,HUTECH,Hồ Chí Minh,25000000,E; C\n,PTIT Hà Nội,,abc,\nbad id!,X,,,\n';

  it('maps columns, coerces typed cells and marks empty mapped cells as cleared', () => {
    const rows = parseCsvRows(csv, { document_id: 'Mã', title: 'Tên', metadata: { province: 'Tỉnh', fee: 'Học phí', houses: 'Hệ' } }, FIELDS);
    expect(rows[0]).toMatchObject({
      row: 1, source: 'dòng 2', documentId: 'hutech', title: 'HUTECH',
      metadata: { province: 'Hồ Chí Minh', fee: 25000000, houses: ['E', 'C'] }, errors: [],
    });
    expect(rows[0]!.body).toBeUndefined();
    expect(rows[1]!.errors.some(e => e.includes('fee'))).toBe(true);
    expect(rows[1]!.metadata.province).toBeNull();
    expect(rows[2]!.errors.some(e => e.includes('document_id'))).toBe(true);
  });

  it('derives ids from titles when no id column is mapped', () => {
    const rows = parseCsvRows(csv, { title: 'Tên', metadata: {} }, FIELDS);
    expect(rows.map(r => r.documentId)).toEqual(['hutech', 'ptit-ha-noi', 'x']);
  });

  it('rejects unknown columns, unknown fields and mappings without id or title', () => {
    expect(() => parseCsvRows(csv, { title: 'Không có', metadata: {} }, FIELDS)).toThrow(ImportInputError);
    expect(() => parseCsvRows(csv, { title: 'Tên', metadata: { nope: 'Tỉnh' } }, FIELDS)).toThrow(ImportInputError);
    expect(() => parseCsvRows(csv, { body: 'Tên', metadata: {} }, FIELDS)).toThrow(ImportInputError);
    expect(() => parseCsvRows('', { title: 'Tên', metadata: {} }, FIELDS)).toThrow(ImportInputError);
  });
});
