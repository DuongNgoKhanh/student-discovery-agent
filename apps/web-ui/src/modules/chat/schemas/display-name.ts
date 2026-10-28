import { z } from 'zod';

/**
 * Tên hiển thị của học sinh. Quy tắc theo docs/openapi/schemas/chat.yaml (SetNameInteraction):
 * NFC, trim và gộp khoảng trắng Unicode; chỉ chữ, dấu và khoảng trắng; không số, không emoji.
 * Giới hạn độ dài chưa chốt (DEC-01), nên chưa đặt maxLength ở đây.
 */

const NAME_PATTERN = /^[\p{L}\p{M}]+(?: [\p{L}\p{M}]+)*$/u;

export function normalizeDisplayName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export const displayNameSchema = z
  .string()
  .transform(normalizeDisplayName)
  .pipe(
    z
      .string()
      .min(1, 'Vui lòng nhập tên.')
      .regex(NAME_PATTERN, 'Tên chỉ gồm chữ cái, không có số hoặc ký tự đặc biệt.'),
  );
