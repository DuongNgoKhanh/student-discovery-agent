/** First CSV record only, enough to offer column names; the server parses the whole file. */
export function csvHeader(text: string): string[] {
  const input = text.replace(/^﻿/, '');
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { cells.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') break;
    else cell += ch;
  }
  if (cell !== '' || cells.length > 0) cells.push(cell.trim());
  return cells;
}
