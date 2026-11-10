import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCsvRows, type CsvMapping } from '@/modules/knowledge/import';
import { validateMetadata, type MetadataField } from '@/modules/knowledge/metadata';

const csv = readFileSync(resolve(__dirname, '../../../../../contracts/fixtures/knowledge-import-sample.csv'), 'utf8');
const fields = [
  { name: 'doc_type', type: 'string' }, { name: 'university', type: 'string' },
  { name: 'major', type: 'string_list' }, { name: 'entry_level', type: 'string_list' },
  { name: 'province', type: 'string_list' }, { name: 'enterprise', type: 'string_list' },
  { name: 'internship_support', type: 'string_list' },
] as const;
const mapping: CsvMapping = {
  document_id: 'document_id', title: 'title', body: 'body', source_url: 'source_url',
  metadata: Object.fromEntries(fields.map(field => [field.name, field.name])),
};

describe('IHRD advisory knowledge CSV import', () => {
  const rows = parseCsvRows(csv, mapping, [...fields]);
  const byId = Object.fromEntries(rows.map(row => [row.documentId, row]));

  it('parses every row without errors', () => {
    expect(rows).toHaveLength(7);
    for (const row of rows) expect(row.errors, row.documentId ?? '').toEqual([]);
  });

  it('turns ; separated cells into lists and empty cells into null', () => {
    expect(byId['doanh-nghiep-mau-b']!.metadata).toMatchObject({
      doc_type: 'doanh_nghiep', university: null, enterprise: ['Mẫu B'],
      province: ['TP. Hồ Chí Minh', 'Đồng Tháp'],
      internship_support: ['hoan_phi', 'luong_thuc_tap', 'cam_ket_viec_lam'],
    });
    expect(byId['tuyen-sinh-mtu']!.metadata).toMatchObject({
      doc_type: 'tuyen_sinh', university: 'MTU', major: ['Công nghệ thông tin', 'Kế toán'],
      entry_level: ['THPT', 'Cao đẳng'], province: null,
    });
    expect(byId['doanh-nghiep-mau-d']!.metadata.major).toBeNull();
  });

  it('keeps the Markdown body, multi-line, with its heading', () => {
    expect(byId['doanh-nghiep-mau-a']!.body).toMatch(/^# Mẫu A \(TP\. Hồ Chí Minh\)\n\nMẫu A là doanh nghiệp mẫu\./);
    expect(byId['tuyen-sinh-mtu']!.title).toBe('Đại học Minh Họa (MTU) — Thông tin tuyển sinh');
  });

  // The commit path (import.service.ts) runs validateMetadata(fields, metadata) with null values dropped by the caller.
  it('passes the metadata validation the commit path applies, for every row', () => {
    const storedFields: MetadataField[] = fields.map(field => ({ id: `id-${field.name}`, name: field.name, type: field.type }));
    for (const row of rows) {
      const present = Object.fromEntries(Object.entries(row.metadata).filter(([, value]) => value !== null && value !== undefined));
      const stored = validateMetadata(storedFields, present);
      expect(Object.keys(stored).length, row.documentId ?? '').toBe(Object.keys(present).length);
    }
    expect(Object.keys(validateMetadata(storedFields, byId['quyen-loi-theo-nganh']!.metadata))).toEqual(['id-doc_type']);
  });
});
