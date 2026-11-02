const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600], ['month', 30 * 24 * 3600], ['week', 7 * 24 * 3600], ['day', 24 * 3600], ['hour', 3600], ['minute', 60],
];
const relative = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });

/** "5 phút trước", "hôm qua"… for timestamps; under a minute reads "vừa xong". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'vừa xong';
}

export const fullDateTime = (iso: string) => new Date(iso).toLocaleString('vi-VN');

/** Lower-case ASCII slug matching the server id pattern `^[a-z0-9][a-z0-9_-]{0,63}$`. */
export function slugify(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
}
