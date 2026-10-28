import { describe, expect, it } from 'vitest';
import { displayNameSchema, normalizeDisplayName } from './display-name';

const parse = (raw: string) => displayNameSchema.safeParse(raw);

describe('displayNameSchema', () => {
  it('chấp nhận tên tiếng Việt có dấu', () => {
    expect(parse('Nguyễn Thị Ngân').success).toBe(true);
  });

  it('trim và gộp khoảng trắng Unicode', () => {
    const result = parse('  Trần    Văn   An ');
    expect(result.success && result.data).toBe('Trần Văn An');
  });

  it('chuẩn hóa NFC: tổ hợp và dạng dựng sẵn cho cùng một kết quả', () => {
    const decomposed = 'Nguyễn';
    const composed = 'Nguyễn';
    expect(normalizeDisplayName(decomposed)).toBe(composed);
  });

  it('từ chối rỗng sau khi trim', () => {
    expect(parse('   ').success).toBe(false);
  });

  it('từ chối chữ số', () => {
    expect(parse('Ngân 2').success).toBe(false);
  });

  it('từ chối emoji và ký tự đặc biệt', () => {
    expect(parse('Ngân 😀').success).toBe(false);
    expect(parse('Ngân<script>').success).toBe(false);
  });
});
