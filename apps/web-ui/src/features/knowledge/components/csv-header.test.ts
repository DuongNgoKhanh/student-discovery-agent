import { describe, expect, it } from 'vitest';
import { csvHeader } from './csv-header';

describe('csvHeader', () => {
  it('reads the first record with quotes and BOM', () => {
    expect(csvHeader('﻿id,"Tên, đầy đủ","""Hệ"""\r\nx,y,z')).toEqual(['id', 'Tên, đầy đủ', '"Hệ"']);
    expect(csvHeader('')).toEqual([]);
  });
});
