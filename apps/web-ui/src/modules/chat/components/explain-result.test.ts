import { describe, expect, it } from 'vitest';
import { parseBlock } from '../schemas/blocks';
import type { TurnResult } from '../schemas/conversation';
import { DEMO_CARD_DATA } from '../fixtures';
import { explainDraft } from './explain-result';

const card = parseBlock({
  block_id: 'b1',
  type: 'personality_card',
  schema_version: 1,
  activity_id: 'a1',
  result_id: 'r1',
  result_revision: 2,
  data: DEMO_CARD_DATA,
});

function result(status: string | null, blocks = [card]): TurnResult {
  return {
    conversationId: 'c1',
    revision: 5,
    turnId: 't1',
    messageId: 'm1',
    blocks,
    activity: status ? ({ status } as TurnResult['activity']) : null,
  };
}

describe('explainDraft', () => {
  it('tạo lượt explain cho thẻ của activity đã hoàn thành', () => {
    expect(explainDraft(result('completed'))).toEqual({
      type: 'interaction',
      activity_id: 'a1',
      action: 'explain_result',
      payload: { result_id: 'r1', result_revision: 2 },
    });
  });

  it('không có thẻ hoặc activity chưa xong thì không gửi', () => {
    expect(explainDraft(result('in_progress'))).toBeNull();
    expect(explainDraft(result('completed', []))).toBeNull();
  });
});
