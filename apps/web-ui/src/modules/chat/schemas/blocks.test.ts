import { describe, expect, it } from 'vitest';
import { parseBlock } from './blocks';
import { DEMO_CARD_DATA, FIXTURE_QUESTIONS } from '../fixtures';

const questionBlock = {
  block_id: 'block_1',
  type: 'assessment_question',
  schema_version: 1,
  activity_id: 'act_1',
  question_id: 'q1',
  title: FIXTURE_QUESTIONS[0]!.title,
  options: FIXTURE_QUESTIONS[0]!.options,
  progress: { completed: 0, total: 6 },
};

describe('parseBlock', () => {
  it('nhận đúng bốn loại block hợp lệ', () => {
    const text = parseBlock({
      block_id: 'b1',
      type: 'text',
      schema_version: 1,
      content: 'Xin chào',
    });
    const question = parseBlock(questionBlock);
    const clarification = parseBlock({
      block_id: 'b3',
      type: 'assessment_clarification',
      schema_version: 1,
      activity_id: 'act_1',
      proposal_id: 'prop_1',
      question_id: 'q1',
      activity_revision: 2,
      title: 'Bạn muốn chọn?',
      candidates: [{ id: 'cand_1', option_id: 'q1_a', label: 'Điều phối' }],
      progress: { completed: 0, total: 6 },
    });
    const card = parseBlock({
      block_id: 'b4',
      type: 'personality_card',
      schema_version: 1,
      activity_id: 'act_1',
      result_id: 'res_1',
      result_revision: 1,
      data: DEMO_CARD_DATA,
    });

    expect([text, question, clarification, card].map((b) => b.kind)).toEqual([
      'known',
      'known',
      'known',
      'known',
    ]);
  });

  it('block có type lạ thành unsupported và giữ block_id để hiển thị', () => {
    const result = parseBlock({ block_id: 'b9', type: 'chart', schema_version: 1 });
    expect(result).toEqual({ kind: 'unsupported', blockId: 'b9', type: 'chart' });
  });

  it('version không hỗ trợ thành unsupported', () => {
    const result = parseBlock({ block_id: 'b1', type: 'text', schema_version: 2, content: 'x' });
    expect(result.kind).toBe('unsupported');
  });

  it('question có ít hơn 2 lựa chọn bị coi là không tương thích', () => {
    const result = parseBlock({ ...questionBlock, options: [{ id: 'q1_a', label: 'Một' }] });
    expect(result.kind).toBe('unsupported');
  });

  it('progress không phải tổng 6 bị coi là không tương thích', () => {
    const result = parseBlock({ ...questionBlock, progress: { completed: 0, total: 5 } });
    expect(result.kind).toBe('unsupported');
  });

  it('giữ markup trong nội dung như text, không làm mất dữ liệu', () => {
    const markup = '<img src=x onerror=alert(1)>';
    const result = parseBlock({ block_id: 'b1', type: 'text', schema_version: 1, content: markup });
    expect(result.kind === 'known' && result.block.type === 'text' && result.block.content).toBe(
      markup,
    );
  });
});
