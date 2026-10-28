import { describe, expect, it } from 'vitest';
import { csvFirstRow, csvHeader, csvRowCount } from './csv-header';

describe('csvHeader', () => {
  it('reads the first record with quotes and BOM', () => {
    expect(csvHeader('﻿id,"Tên, đầy đủ","""Hệ"""\r\nx,y,z')).toEqual(['id', 'Tên, đầy đủ', '"Hệ"']);
    expect(csvHeader('')).toEqual([]);
  });

  it('reads the first data row across quoted line breaks and counts rows', () => {
    const text = 'id,body,note\r\n\r\n1,"dòng 1\ndòng 2",\n2,b,c\n';
    expect(csvFirstRow(text)).toEqual(['1', 'dòng 1\ndòng 2', '']);
    expect(csvRowCount(text)).toBe(2);
    expect(csvFirstRow('id')).toEqual([]);
    expect(csvRowCount('')).toBe(0);
  });
});
