import { createChatApi, type ChatApi } from './chat-api';
import { createMockTransport } from './mock-transport';
import { httpTransport } from './transport';

/**
 * Chọn nguồn dữ liệu chat. Mặc định dùng mock để UI chạy khi backend chat chưa có.
 * Đặt NEXT_PUBLIC_CHAT_MOCK=false lúc build để gọi BFF thật (studio-api /api/v1/conversations).
 */
export const CHAT_MOCK_ENABLED = process.env.NEXT_PUBLIC_CHAT_MOCK !== 'false';

let instance: ChatApi | null = null;

export function getChatApi(): ChatApi {
  if (!instance) {
    instance = createChatApi(
      CHAT_MOCK_ENABLED ? createMockTransport({ delayMs: 250 }) : httpTransport,
    );
  }
  return instance;
}

export { createChatApi, type ChatApi, type ChatTurnInput } from './chat-api';
export { createMockTransport } from './mock-transport';
