// Public surface của module chat. Nơi khác chỉ import từ đây.
export { ChatShell } from './components/chat-shell';
export { getChatApi, CHAT_MOCK_ENABLED, type ChatApi, type ChatTurnInput } from './api';
export { parseBlock, type RenderableBlock, type KnownBlock } from './schemas/blocks';
export { normalizeDisplayName, displayNameSchema } from './schemas/display-name';
