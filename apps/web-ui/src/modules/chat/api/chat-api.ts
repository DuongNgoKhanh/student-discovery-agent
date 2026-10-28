import { unwrapChatEnvelope } from '../schemas/envelope';
import {
  conversationCreatedSchema,
  conversationViewSchema,
  toCreatedConversation,
  toTurnResult,
  turnResultSchema,
  type ConversationView,
  type CreatedConversation,
  type TurnResult,
} from '../schemas/conversation';
import type { ChatTransport } from './transport';

/**
 * Input của một lượt. Nguồn: docs/openapi/schemas/chat.yaml.
 * `expected_revision` là revision conversation đang hiển thị; `idempotency_key` giữ nguyên khi retry (QT-04).
 */
export interface TurnBase {
  expected_revision: number;
  idempotency_key: string;
}

export type ChatTurnInput =
  | (TurnBase & { type: 'message'; content: { text: string } })
  | (TurnBase & {
      type: 'interaction';
      activity_id: string;
      action: 'set_name';
      payload: { display_name: string };
    })
  | (TurnBase & {
      type: 'interaction';
      activity_id: string;
      action: 'submit_answer' | 'edit_answer';
      payload: { question_id: string; option_id: string };
    })
  | (TurnBase & {
      type: 'interaction';
      activity_id: string;
      action: 'confirm_answer';
      payload: { proposal_id: string; question_id: string; candidate_id: string };
    });

/** Lỗi nghiệp vụ được ném dưới dạng ApiError; xem error-map.ts cho mã và thông điệp. */
export interface ChatApi {
  createConversation(idempotencyKey: string): Promise<CreatedConversation>;
  readConversation(conversationId: string): Promise<ConversationView>;
  sendTurn(conversationId: string, input: ChatTurnInput): Promise<TurnResult>;
}

export function createChatApi(transport: ChatTransport): ChatApi {
  return {
    async createConversation(idempotencyKey) {
      const res = await transport.request('POST', 'conversations', {
        idempotency_key: idempotencyKey,
        schema_version: 1,
      });
      const data = unwrapChatEnvelope(res.body, res.status, conversationCreatedSchema);
      return toCreatedConversation(data);
    },

    async readConversation(conversationId) {
      const res = await transport.request('GET', `conversations/${conversationId}`);
      return unwrapChatEnvelope(res.body, res.status, conversationViewSchema);
    },

    async sendTurn(conversationId, input) {
      const res = await transport.request('POST', `conversations/${conversationId}/turns`, {
        ...input,
        schema_version: 1,
      });
      const data = unwrapChatEnvelope(res.body, res.status, turnResultSchema);
      return toTurnResult(data);
    },
  };
}
