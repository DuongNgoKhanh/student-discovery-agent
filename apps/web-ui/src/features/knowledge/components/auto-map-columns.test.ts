import { describe, expect, it } from 'vitest';
import { autoMapColumns } from './auto-map-columns';

describe('autoMapColumns', () => {
  const targets = [
    { key: 'document_id', names: ['document_id', 'Mã tài liệu'] },
    { key: 'title', names: ['title', 'Tiêu đề'] },
    { key: 'source_url', names: ['source_url', 'Nguồn'] },
    { key: 'meta:hoc_phi', names: ['hoc_phi', 'Học phí'] },
  ];

  it('matches names and labels regardless of case, diacritics and separators', () => {
    expect(autoMapColumns(['MÃ TÀI LIỆU', 'tieu de', 'Source URL', 'HOC PHI', 'ghi chú'], targets)).toEqual({
      document_id: 'MÃ TÀI LIỆU', title: 'tieu de', source_url: 'Source URL', 'meta:hoc_phi': 'HOC PHI',
    });
  });

  it('leaves targets without a matching column unmapped and uses each column once', () => {
    expect(autoMapColumns(['title'], [{ key: 'a', names: ['title'] }, { key: 'b', names: ['Title'] }])).toEqual({ a: 'title' });
    expect(autoMapColumns(['ma', 'ten'], targets)).toEqual({});
  });
});
