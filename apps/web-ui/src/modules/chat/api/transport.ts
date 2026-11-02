/**
 * Tầng vận chuyển thô: trả HTTP status và body JSON chưa kiểm tra.
 * Có hai cài đặt: HTTP qua BFF studio-api (dùng thật) và in-memory (mock, xem mock-transport.ts).
 * Tách như vậy để mock đi qua đúng đường parse envelope như API thật.
 */
export interface RawResponse {
  status: number;
  body: unknown;
}

export interface ChatTransport {
  request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<RawResponse>;
}

/**
 * Browser chỉ gọi same-origin: studio-api là BFF, cấp cookie owner ẩn danh `sda_owner` (Path=/api/v1)
 * và ký caller context trước khi chuyển sang runtime.
 */
const BFF_BASE = '/api/v1';

export const httpTransport: ChatTransport = {
  async request(method, path, body) {
    const res = await fetch(`${BFF_BASE}/${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // Body không phải JSON: để unwrapChatEnvelope báo lỗi envelope.
    }
    return { status: res.status, body: json };
  },
};
