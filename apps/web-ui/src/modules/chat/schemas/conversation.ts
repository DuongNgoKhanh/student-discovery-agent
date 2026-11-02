import { z } from 'zod';
import { activityViewSchema } from './activity';
import { idSchema, parseBlock, type RenderableBlock } from './blocks';

/** Nguồn: docs/openapi/schemas/chat.yaml (ConversationView, ConversationTurnResult). */

export const conversationViewSchema = z
  .object({
    id: idSchema,
    schema_version: z.literal(1),
    status: z.enum(['active', 'ended', 'expired']),
    revision: z.number().int().min(0),
    agent_release_id: idSchema,
    display_name: z.string().min(1).nullable(),
    active_activity: activityViewSchema.nullable(),
    created_at: z.string(),
    expires_at: z.string(),
  })
  .passthrough();

export type ConversationView = z.infer<typeof conversationViewSchema>;

/**
 * `data` của POST /conversations/{id}/messages và GET /responses/{id}
 * (contracts/openapi/public/conversation-api.yaml). `activity` là bản gọn, có thể thiếu `answers`.
 */
export const messageResponseSchema = z
  .object({
    id: idSchema,
    conversation_id: idSchema,
    status: z.enum(['in_progress', 'completed', 'failed', 'cancelled']),
    revision: z.number().int().min(0),
    output: z
      .object({ message_id: idSchema, blocks: z.array(z.unknown()).min(1) })
      .passthrough()
      .nullable(),
    activity: z.unknown().nullable().optional(),
    error: z.object({ code: z.string().min(1) }).passthrough().nullable().optional(),
  })
  .passthrough();

export type MessageResponse = z.infer<typeof messageResponseSchema>;

export const conversationCreatedSchema = z
  .object({
    conversation: conversationViewSchema,
    message_id: idSchema,
    blocks: z.array(z.unknown()).min(1),
  })
  .passthrough();

/** Kết quả đã map sang kiểu UI dùng: block đã được kiểm tra từng cái. */
export interface TurnResult {
  conversationId: string;
  revision: number;
  turnId: string;
  messageId: string;
  activity: z.infer<typeof activityViewSchema> | null;
  blocks: RenderableBlock[];
}

export interface CreatedConversation {
  conversation: ConversationView;
  messageId: string;
  blocks: RenderableBlock[];
}

export function toCreatedConversation(
  raw: z.infer<typeof conversationCreatedSchema>,
): CreatedConversation {
  return {
    conversation: raw.conversation,
    messageId: raw.message_id,
    blocks: raw.blocks.map(parseBlock),
  };
}
