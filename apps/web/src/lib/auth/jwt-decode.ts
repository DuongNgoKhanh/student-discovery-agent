export interface JwtPayload {
  sub?: string;
  admin?: boolean;
  exp?: number;
  type?: string;
}

/**
 * Decode payload JWT (KHÔNG verify chữ ký). Chỉ dùng làm cổng UX
 * (middleware / hiển thị) — backend vẫn là nguồn chân lý xác thực.
 * Chạy được ở cả edge runtime lẫn node (dùng atob, không dùng Buffer).
 */
export function decodeJwt(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1] ?? '';
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/** Token coi như hết hạn nếu thiếu exp hoặc còn dưới `skewSec` giây. */
export function isExpired(payload: JwtPayload | null, skewSec = 30): boolean {
  if (!payload?.exp) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  return payload.exp <= nowSec + skewSec;
}
