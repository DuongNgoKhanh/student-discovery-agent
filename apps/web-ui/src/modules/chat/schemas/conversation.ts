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

/** Dữ liệu trong `data` của một turn sau khi server commit. `blocks` còn ở dạng thô. */
export const turnResultSchema = z
  .object({
    conversation_id: idSchema,
    schema_version: z.literal(1),
    revision: z.number().int().min(0),
    turn_id: idSchema,
    message_id: idSchema,
    committed_at: z.string(),
    activity: activityViewSchema.nullable(),
    blocks: z.array(z.unknown()).min(1),
  })
  .passthrough();

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

export function toTurnResult(raw: z.infer<typeof turnResultSchema>): TurnResult {
  return {
    conversationId: raw.conversation_id,
    revision: raw.revision,
    turnId: raw.turn_id,
    messageId: raw.message_id,
    activity: raw.activity,
    blocks: raw.blocks.map(parseBlock),
  };
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
