import { ChatShell } from '@/modules/chat';

// Chat ẩn danh: không nằm dưới /dashboard nên không đi qua middleware đăng nhập.
export default function ChatPage() {
  return <ChatShell />;
}
