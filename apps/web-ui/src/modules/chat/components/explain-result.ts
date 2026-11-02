import type { TurnDraft } from '../hooks/use-chat';
import type { TurnResult } from '../schemas/conversation';

export type ExplainDraft = Extract<TurnDraft, { action: 'explain_result' }>;

/** Lượt nhờ Agent giải thích thẻ vừa nhận; null khi lượt này không trả về thẻ của bài đã xong. */
export function explainDraft(result: TurnResult): ExplainDraft | null {
  if (result.activity?.status !== 'completed') return null;
  for (const block of result.blocks) {
    if (block.kind === 'known' && block.block.type === 'personality_card') {
      const card = block.block;
      return {
        type: 'interaction',
        activity_id: card.activity_id,
        action: 'explain_result',
        payload: { result_id: card.result_id, result_revision: card.result_revision },
      };
    }
  }
  return null;
}
