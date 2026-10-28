import { describe, expect, it } from 'vitest';
import { highlightSegments } from './highlight';

const marked = (text: string, query: string) => highlightSegments(text, query).filter(segment => segment.match).map(segment => segment.text);

describe('highlightSegments', () => {
  it('matches ignoring case and Vietnamese diacritics, keeping the original text', () => {
    expect(marked('Học phí ngành Công nghệ thông tin', 'hoc PHI cong-nghe')).toEqual(['Học', 'phí', 'Công', 'nghệ']);
    expect(marked('Trường Đà Nẵng', 'đà nang')).toEqual(['Đà', 'Nẵng']);
    expect(marked('khoa học', 'hoa')).toEqual(['hoa']);
    expect(highlightSegments('Học phí 2026', 'học').map(segment => segment.text).join('')).toBe('Học phí 2026');
  });

  it('keeps decomposed marks inside the match and ignores one-letter terms', () => {
    expect(marked('Học phí', 'hoc phi')).toEqual(['Học', 'phí']);
    expect(highlightSegments('a b c', 'a')).toEqual([{ text: 'a b c', match: false }]);
  });
});
