export interface Segment { text: string; match: boolean }

const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

/** Folded text plus, per folded code unit, the original [start, end) it came from; marks fold into the previous char. */
function foldWithMap(text: string) {
  let folded = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const char of text) {
    const piece = fold(char);
    if (piece === '' && ends.length > 0) ends[ends.length - 1] = index + char.length;
    for (let i = 0; i < piece.length; i += 1) { starts.push(index); ends.push(index + char.length); }
    folded += piece;
    index += char.length;
  }
  return { folded, starts, ends };
}

/** Splits `text` into plain and matched runs for the query's terms (≥ 2 chars), ignoring case and Vietnamese diacritics. */
export function highlightSegments(text: string, query: string): Segment[] {
  const terms = [...new Set(fold(query).split(/[^\p{L}\p{N}]+/u).filter(term => term.length >= 2))];
  if (terms.length === 0 || text === '') return text ? [{ text, match: false }] : [];
  const { folded, starts, ends } = foldWithMap(text);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      ranges.push([starts[at]!, ends[at + term.length - 1]!]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (end <= cursor) continue;
    const from = Math.max(start, cursor);
    if (from > cursor) segments.push({ text: text.slice(cursor, from), match: false });
    const last = segments[segments.length - 1];
    if (last?.match && from === cursor) last.text += text.slice(from, end);
    else segments.push({ text: text.slice(from, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}
