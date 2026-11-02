/** Only same-origin paths starting with a single "/" are allowed as redirect targets. */
export function safeNext(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\'))
    return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}

/** Link chuyển giữa đăng nhập và đăng ký, giữ `next` chỉ khi nó an toàn. */
export function withNext(path: string, next: string | null | undefined): string {
  if (!next || safeNext(next) !== next) return path;
  return `${path}?next=${encodeURIComponent(next)}`;
}
