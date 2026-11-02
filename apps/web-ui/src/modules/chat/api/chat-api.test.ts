import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { createChatApi, type ChatApi } from './chat-api';
import { createMockTransport, type MockTransport } from './mock-transport';
import { FIXTURE_QUESTIONS } from '../fixtures';
import type { TurnResult } from '../schemas/conversation';

function setup(options: Parameters<typeof createMockTransport>[0] = {}) {
  const transport: MockTransport = createMockTransport({ delayMs: 0, ...options });
  const api: ChatApi = createChatApi(transport);
  return { api, transport };
}

let keySeq = 0;
const key = (prefix: string) => `${prefix}_${++keySeq}`;

/** Bắt đầu phiên tới trạng thái chờ trả lời câu 1. */
async function startToQuestion(api: ChatApi) {
  const created = await api.createConversation(key('create'));
  const conv = created.conversation.id;
  let rev = created.conversation.revision;

  const started = await api.sendTurn(conv, {
    type: 'message',
    expected_revision: rev,
    idempotency_key: key('start'),
    content: { text: 'Bắt đầu' },
  });
  rev = started.revision;
  const activityId = started.activity!.id;

  const named = await api.sendTurn(conv, {
    type: 'interaction',
    activity_id: activityId,
    action: 'set_name',
    expected_revision: rev,
    idempotency_key: key('name'),
    payload: { display_name: 'Ngân' },
  });
  return { api, conv, activityId, rev: named.revision, last: named };
}

async function answer(
  api: ChatApi,
  conv: string,
  activityId: string,
  rev: number,
  questionIndex: number,
  optionIndex = 0,
): Promise<TurnResult> {
  const q = FIXTURE_QUESTIONS[questionIndex]!;
  return api.sendTurn(conv, {
    type: 'interaction',
    activity_id: activityId,
    action: 'submit_answer',
    expected_revision: rev,
    idempotency_key: key('ans'),
    payload: { question_id: q.question_id, option_id: q.options[optionIndex]!.id },
  });
}

describe('chat API với mock transport', () => {
  it('tạo conversation và nhận greeting dạng block text', async () => {
    const { api } = setup();
    const created = await api.createConversation(key('create'));
    expect(created.conversation.status).toBe('active');
    expect(created.conversation.active_activity).toBeNull();
    expect(created.blocks[0]).toMatchObject({ kind: 'known', block: { type: 'text' } });
  });

  it('đọc lại conversation trả đúng state', async () => {
    const { api } = setup();
    const created = await api.createConversation(key('create'));
    const read = await api.readConversation(created.conversation.id);
    expect(read.id).toBe(created.conversation.id);
    expect(read.revision).toBe(created.conversation.revision);
  });

  it('nhập tên đưa phiên sang in_progress với progress 0/6; tên không tính là đáp án', async () => {
    const s = await startToQuestion(setup().api);
    expect(s.last.activity?.status).toBe('in_progress');
    expect(s.last.activity?.progress.completed).toBe(0);
    expect(
      s.last.blocks.some((b) => b.kind === 'known' && b.block.type === 'assessment_question'),
    ).toBe(true);
  });

  it('từ chối tên không hợp lệ với lỗi INVALID_INPUT', async () => {
    const { api } = setup();
    const created = await api.createConversation(key('create'));
    const started = await api.sendTurn(created.conversation.id, {
      type: 'message',
      expected_revision: created.conversation.revision,
      idempotency_key: key('start'),
      content: { text: 'Bắt đầu' },
    });
    await expect(
      api.sendTurn(created.conversation.id, {
        type: 'interaction',
        activity_id: started.activity!.id,
        action: 'set_name',
        expected_revision: started.revision,
        idempotency_key: key('name'),
        payload: { display_name: 'Ngân 123' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('trả đủ 6 đáp án thì hoàn thành và trả thẻ demo', async () => {
    const s = await startToQuestion(setup().api);
    let rev = s.rev;
    let last: TurnResult | null = null;
    for (let i = 0; i < 6; i++) {
      last = await answer(s.api, s.conv, s.activityId, rev, i);
      rev = last.revision;
    }
    expect(last!.activity?.status).toBe('completed');
    expect(last!.activity?.progress.completed).toBe(6);
    const card = last!.blocks.find(
      (b) => b.kind === 'known' && b.block.type === 'personality_card',
    );
    expect(card).toBeDefined();
  });

  it('revision cũ bị từ chối với REVISION_CONFLICT kèm state mới', async () => {
    const s = await startToQuestion(setup().api);
    const err = await answer(s.api, s.conv, s.activityId, s.rev - 1, 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('REVISION_CONFLICT');
    expect((err as ApiError).details).toMatchObject({ kind: 'revision_conflict' });
  });

  it('retry cùng key và payload không ghi đáp án trùng', async () => {
    const s = await startToQuestion(setup().api);
    const q = FIXTURE_QUESTIONS[0]!;
    const input = {
      type: 'interaction' as const,
      activity_id: s.activityId,
      action: 'submit_answer' as const,
      expected_revision: s.rev,
      idempotency_key: key('retry'),
      payload: { question_id: q.question_id, option_id: q.options[0]!.id },
    };
    const first = await s.api.sendTurn(s.conv, input);
    const second = await s.api.sendTurn(s.conv, input);
    expect(second.revision).toBe(first.revision);
    expect(second.activity?.progress.completed).toBe(1);
  });

  it('cùng key nhưng khác payload bị từ chối', async () => {
    const s = await startToQuestion(setup().api);
    const q = FIXTURE_QUESTIONS[0]!;
    const base = {
      type: 'interaction' as const,
      activity_id: s.activityId,
      action: 'submit_answer' as const,
      expected_revision: s.rev,
      idempotency_key: key('collide'),
    };
    await s.api.sendTurn(s.conv, {
      ...base,
      payload: { question_id: q.question_id, option_id: q.options[0]!.id },
    });
    await expect(
      s.api.sendTurn(s.conv, {
        ...base,
        payload: { question_id: q.question_id, option_id: q.options[1]!.id },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_COLLISION' });
  });

  it('text chỉ tạo đề xuất; chỉ xác nhận mới tăng progress', async () => {
    const s = await startToQuestion(setup().api);
    const withText = await s.api.sendTurn(s.conv, {
      type: 'message',
      expected_revision: s.rev,
      idempotency_key: key('text'),
      content: { text: 'mình thích tổ chức' },
    });
    expect(withText.activity?.progress.completed).toBe(0);
    const clar = withText.blocks.find(
      (b) => b.kind === 'known' && b.block.type === 'assessment_clarification',
    );
    expect(clar).toBeDefined();
    if (!clar || clar.kind !== 'known' || clar.block.type !== 'assessment_clarification') return;

    const confirmed = await s.api.sendTurn(s.conv, {
      type: 'interaction',
      activity_id: s.activityId,
      action: 'confirm_answer',
      expected_revision: withText.revision,
      idempotency_key: key('confirm'),
      payload: {
        proposal_id: clar.block.proposal_id,
        question_id: clar.block.question_id,
        candidate_id: clar.block.candidates[0]!.id,
      },
    });
    expect(confirmed.activity?.progress.completed).toBe(1);
  });

  it('sửa câu 2 khi đang 6/6 còn progress 2/6, câu 3 mới, thẻ cũ bị gỡ', async () => {
    const s = await startToQuestion(setup().api);
    let rev = s.rev;
    for (let i = 0; i < 6; i++) {
      rev = (await answer(s.api, s.conv, s.activityId, rev, i)).revision;
    }
    const edited = await s.api.sendTurn(s.conv, {
      type: 'interaction',
      activity_id: s.activityId,
      action: 'edit_answer',
      expected_revision: rev,
      idempotency_key: key('edit'),
      payload: {
        question_id: FIXTURE_QUESTIONS[1]!.question_id,
        option_id: FIXTURE_QUESTIONS[1]!.options[2]!.id,
      },
    });
    expect(edited.activity?.progress.completed).toBe(2);
    expect(edited.activity?.status).toBe('in_progress');
    const question = edited.blocks.find(
      (b) => b.kind === 'known' && b.block.type === 'assessment_question',
    );
    expect(
      question &&
        question.kind === 'known' &&
        question.block.type === 'assessment_question' &&
        question.block.question_id,
    ).toBe(FIXTURE_QUESTIONS[2]!.question_id);
    expect(
      edited.blocks.some((b) => b.kind === 'known' && b.block.type === 'personality_card'),
    ).toBe(false);
  });

  it('phiên đã kết thúc không nhận lượt mới', async () => {
    const { api, transport } = setup();
    const created = await api.createConversation(key('create'));
    transport.endConversation(created.conversation.id);
    await expect(
      api.sendTurn(created.conversation.id, {
        type: 'message',
        expected_revision: created.conversation.revision,
        idempotency_key: key('late'),
        content: { text: 'xin chào' },
      }),
    ).rejects.toMatchObject({ code: 'CONVERSATION_ENDED' });
  });

  it('môi trường chưa cấu hình trả lỗi, không tạo phiên giả', async () => {
    const { api } = setup({ configured: false });
    await expect(api.createConversation(key('create'))).rejects.toMatchObject({
      code: 'EXPERIENCE_NOT_CONFIGURED',
    });
  });
});

describe('chatApi qua contract /messages của BFF', () => {
  const meta = { request_id: 'req', trace_id: 'trace', timestamp: '2026-10-28T00:00:00Z' };
  const ok = (status: number, data: unknown) => ({ status, body: { status, success: true, data, error: null, meta } });
  const activity = {
    id: 'act1', conversation_id: 'conv1', type: 'personality_assessment_adaptive', schema_version: 2,
    status: 'in_progress', revision: 1, display_name: 'An', is_demo: true, answers: [], clarification: null, result: null,
    progress: { completed: 0, min_total: 12, max_total: 15, total: null },
    current_question: { question_id: 'q1', title: 'Câu 1', options: [{ id: 'o1', label: 'A' }, { id: 'o2', label: 'B' }] },
  };
  const conversation = {
    id: 'conv1', schema_version: 1, status: 'active', revision: 2, agent_release_id: 'rel1', display_name: 'An',
    active_activity: activity, created_at: 'x', expires_at: 'y',
  };
  const completed = (extra: Record<string, unknown> = {}) => ({
    id: 'resp1', conversation_id: 'conv1', status: 'completed', revision: 2,
    output: { message_id: 'msg1', blocks: [{ block_id: 'b1', type: 'text', schema_version: 1, content: 'Chào' }] },
    activity: null, error: null, ...extra,
  });

  function recording(responses: Record<string, unknown>) {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const api = createChatApi({
      async request(method, path, body) {
        calls.push({ method, path, body });
        return responses[`${method} ${path}`] as { status: number; body: unknown };
      },
    });
    return { api, calls };
  }

  it('khai activity profile và block hỗ trợ khi tạo hội thoại', async () => {
    const { api, calls } = recording({
      'POST conversations': ok(201, { conversation: { ...conversation, revision: 0, active_activity: null }, message_id: 'm0', blocks: [{ block_id: 'b0', type: 'text', schema_version: 1, content: 'Chào' }] }),
    });
    await api.createConversation('create_1');
    expect(calls[0]!.body).toMatchObject({
      idempotency_key: 'create_1',
      accepted_activity_profiles: ['riasec.mean.bounds.v2'],
      supported_blocks: expect.arrayContaining([{ type: 'assessment_question', schema_versions: [1, 2] }]),
    });
  });

  it('gửi interaction thành một content part và đọc lại activity khi response chỉ có bản gọn', async () => {
    const { api, calls } = recording({
      'POST conversations/conv1/messages': ok(200, completed({ activity: { id: 'act1', status: 'in_progress' } })),
      'GET conversations/conv1': ok(200, conversation),
    });
    const result = await api.sendTurn('conv1', {
      type: 'interaction', activity_id: 'act1', action: 'set_name', payload: { display_name: 'An' },
      expected_revision: 1, idempotency_key: 'turn_1',
    });
    expect(calls[0]!.body).toEqual({
      expected_revision: 1, idempotency_key: 'turn_1',
      content: [{ type: 'interaction', activity_id: 'act1', action: 'set_name', payload: { display_name: 'An' } }],
    });
    expect(calls[1]).toMatchObject({ method: 'GET', path: 'conversations/conv1' });
    expect(result).toMatchObject({ revision: 2, turnId: 'resp1', messageId: 'msg1', activity: { id: 'act1', status: 'in_progress' } });
  });

  it('gửi text tự do dạng {type:"text"}', async () => {
    const { api, calls } = recording({ 'POST conversations/conv1/messages': ok(200, completed()) });
    await api.sendTurn('conv1', { type: 'message', content: { text: 'xin chào' }, expected_revision: 1, idempotency_key: 'turn_2' });
    expect(calls[0]!.body).toEqual({ expected_revision: 1, idempotency_key: 'turn_2', content: [{ type: 'text', text: 'xin chào' }] });
  });

  it('lượt failed thành ApiError với mã đã chuẩn hoá', async () => {
    const { api } = recording({
      'POST conversations/conv1/messages': ok(200, completed({ status: 'failed', output: null, error: { code: 'SYS_ENGINE_FAILURE' } })),
    });
    await expect(
      api.sendTurn('conv1', { type: 'message', content: { text: 'x' }, expected_revision: 1, idempotency_key: 'turn_3' }),
    ).rejects.toMatchObject({ code: 'SYS_ENGINE_FAILURE', httpStatus: 200 });
  });

  it('đổi mã lỗi registry mới về tên UI đang xử lý', async () => {
    const { api } = recording({
      'POST conversations/conv1/messages': {
        status: 409,
        body: { status: 409, success: false, data: null, meta, error: { code: 'CONFLICT_REVISION', message: 'x', retryable: false, details: null } },
      },
    });
    await expect(
      api.sendTurn('conv1', { type: 'message', content: { text: 'x' }, expected_revision: 0, idempotency_key: 'turn_4' }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });
});
