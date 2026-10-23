/**
 * Common Vietnamese family names (covering the large majority of the population). Used to tell
 * "Nguyễn Minh An" (family name first) from "Khánh Linh" (given names only).
 */
const FAMILY_NAMES = new Set(
  [
    'Nguyễn',
    'Trần',
    'Lê',
    'Phạm',
    'Hoàng',
    'Huỳnh',
    'Phan',
    'Vũ',
    'Võ',
    'Đặng',
    'Bùi',
    'Đỗ',
    'Hồ',
    'Ngô',
    'Dương',
    'Lý',
    'Đinh',
    'Đào',
    'Đoàn',
    'Lâm',
    'Mai',
    'Trịnh',
    'Trương',
    'Cao',
    'Lương',
    'Tạ',
    'Tô',
    'Hà',
    'Châu',
    'Thái',
    'Quách',
    'Lưu',
    'Kiều',
    'Tăng',
    'Văn',
    'Từ',
  ].map((n) => n.normalize('NFC').toLocaleLowerCase('vi')),
);

/** "Ẩn họ": drop a leading family name; names without a recognisable one are left as typed. */
export function withoutFamilyName(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name.trim();
  const first = parts[0]!.normalize('NFC').toLocaleLowerCase('vi');
  return FAMILY_NAMES.has(first) ? parts.slice(1).join(' ') : parts.join(' ');
}
