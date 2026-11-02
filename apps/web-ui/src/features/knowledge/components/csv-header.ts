/**
 * Minimal RFC 4180 reader for the import wizard: column names, a sample row and the row count.
 * The server parses the whole file again, so this only has to agree on record boundaries.
 * Blank lines are skipped; at most `limit` records are returned.
 */
export function csvRecords(text: string, limit = Infinity): string[][] {
  const input = text.replace(/^﻿/, '');
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  let touched = false;
  const endRecord = () => {
    if (touched) record.push(cell.trim());
    if (record.some(value => value !== '') || record.length > 1) records.push(record);
    record = [];
    cell = '';
    touched = false;
  };
  for (let i = 0; i < input.length && records.length < limit; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && cell === '') { quoted = true; touched = true; }
    else if (ch === ',') { record.push(cell.trim()); cell = ''; touched = true; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      endRecord();
    } else { cell += ch; touched = true; }
  }
  if (records.length < limit) endRecord();
  return records;
}

/** First CSV record only, enough to offer column names. */
export const csvHeader = (text: string): string[] => csvRecords(text, 1)[0] ?? [];

/** The first data record (after the header), used to show a sample value per column. */
export const csvFirstRow = (text: string): string[] => csvRecords(text, 2)[1] ?? [];

/** Number of non-blank data records. */
export const csvRowCount = (text: string): number => Math.max(0, csvRecords(text).length - 1);
