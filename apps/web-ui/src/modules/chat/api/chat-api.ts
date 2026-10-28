import { ApiError } from '@/lib/api/errors';
import { mapErrorMessage } from '@/lib/api/error-map';
import { activityViewSchema, type ActivityView } from '../schemas/activity';
import { parseBlock } from '../schemas/blocks';
import { chatErrorCode, unwrapChatEnvelope } from '../schemas/envelope';
import {
  conversationCreatedSchema,
  conversationViewSchema,
  messageResponseSchema,
  toCreatedConversation,
  type ConversationView,
  type CreatedConversation,
  type MessageResponse,
  type TurnResult,
} from '../schemas/conversation';
import type { ChatTransport } from './transport';

/** Activity profile và block UI render được; runtime chọn release/định dạng theo đây (capability negotiation). */
export const ACCEPTED_ACTIVITY_PROFILES = ['riasec.mean.bounds.v2'];
export const SUPPORTED_BLOCKS = [
  { type: 'text', schema_versions: [1] },
  { type: 'assessment_question', schema_versions: [1, 2] },
  { type: 'assessment_clarification', schema_versions: [1, 2] },
  { type: 'personality_card', schema_versions: [1] },
];

const POLL_DEADLINE_MS = 90_000;

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

/** Một lượt = đúng một content part: text tự do hoặc interaction của activity. */
function toMessageBody(input: ChatTurnInput) {
  const { expected_revision, idempotency_key } = input;
  if (input.type === 'message') {
    return { expected_revision, idempotency_key, content: [{ type: 'text', text: input.content.text }] };
  }
  const { activity_id, action, payload } = input;
  return { expected_revision, idempotency_key, content: [{ type: 'interaction', activity_id, action, payload }] };
}

function turnFailed(response: MessageResponse): ApiError {
  const code = chatErrorCode(response.error?.code ?? 'INTERNAL_ERROR');
  return new ApiError({
    code,
    message: mapErrorMessage(code),
    details: { response_id: response.id, status: response.status },
    // Lượt failed/cancelled không ghi gì; gửi lại với key mới là an toàn.
    retryable: false,
    httpStatus: 200,
  });
}

export function createChatApi(transport: ChatTransport): ChatApi {
  async function readConversation(conversationId: string): Promise<ConversationView> {
    const res = await transport.request('GET', `conversations/${conversationId}`);
    return unwrapChatEnvelope(res.body, res.status, conversationViewSchema);
  }

  /** Lượt đã nhận nhưng chưa xong (ví dụ bị gián đoạn): chờ kết quả đã commit thay vì đoán. */
  async function waitForResponse(responseId: string): Promise<MessageResponse> {
    const deadline = Date.now() + POLL_DEADLINE_MS;
    for (let wait = 500; ; wait = Math.min(wait * 2, 4000)) {
      const res = await transport.request('GET', `responses/${responseId}`);
      const response = unwrapChatEnvelope(res.body, res.status, messageResponseSchema);
      if (response.status !== 'in_progress' || Date.now() > deadline) return response;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  /** Response gọn của /messages không có `answers[]`; khi activity không đủ field thì đọc lại view đầy đủ. */
  async function fullActivity(
    conversationId: string,
    activity: unknown,
  ): Promise<ActivityView | null> {
    if (activity === null || activity === undefined) return null;
    const parsed = activityViewSchema.safeParse(activity);
    if (parsed.success) return parsed.data;
    return (await readConversation(conversationId)).active_activity;
  }

  return {
    async createConversation(idempotencyKey) {
      const res = await transport.request('POST', 'conversations', {
        idempotency_key: idempotencyKey,
        accepted_activity_profiles: ACCEPTED_ACTIVITY_PROFILES,
        supported_blocks: SUPPORTED_BLOCKS,
      });
      const data = unwrapChatEnvelope(res.body, res.status, conversationCreatedSchema);
      return toCreatedConversation(data);
    },

    readConversation,

    async sendTurn(conversationId, input) {
      const res = await transport.request(
        'POST',
        `conversations/${conversationId}/messages`,
        toMessageBody(input),
      );
      let response = unwrapChatEnvelope(res.body, res.status, messageResponseSchema);
      if (response.status === 'in_progress') response = await waitForResponse(response.id);
      if (response.status !== 'completed' || !response.output) throw turnFailed(response);
      return {
        conversationId: response.conversation_id,
        revision: response.revision,
        turnId: response.id,
        messageId: response.output.message_id,
        activity: await fullActivity(conversationId, response.activity),
        blocks: response.output.blocks.map(parseBlock),
      };
    },
  };
}
