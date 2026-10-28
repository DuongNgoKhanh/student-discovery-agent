import { displayNameSchema } from '../schemas/display-name';
import {
  DEMO_CARD_DATA,
  DEMO_NOTICE_TEXT,
  FIXTURE_QUESTIONS,
  GREETING_TEXT,
  NAME_PROMPT_TEXT,
  errorEnvelope,
  successEnvelope,
  type FixtureQuestion,
} from '../fixtures';
import type { ChatTransport, RawResponse } from './transport';

/**
 * Transport giả lập theo đúng luật SRS (QT-02..08) để UI chạy không cần backend.
 * State nằm trong bộ nhớ: reload trang sẽ tạo phiên mới (FR-UI-04 chỉ kiểm được trên backend thật).
 * Response đi qua cùng tầng parse envelope như HTTP, nên lỗi shape sẽ lộ ra khi test.
 */

const TOTAL = 6;

type ActivityStatus = 'collecting_name' | 'in_progress' | 'completed' | 'ended' | 'expired';

interface Answer {
  question_id: string;
  option_id: string;
}

interface Proposal {
  proposal_id: string;
  question_id: string;
  candidates: { id: string; option_id: string; label: string }[];
}

interface MockActivity {
  id: string;
  status: ActivityStatus;
  revision: number;
  display_name: string | null;
  answers: Answer[];
  proposal: Proposal | null;
  resultRevision: number | null;
}

interface MockConversation {
  id: string;
  revision: number;
  status: 'active' | 'ended' | 'expired';
  activity: MockActivity | null;
  idempotency: Map<string, { payload: string; response: RawResponse }>;
}

export interface MockTransportOptions {
  /** false mô phỏng môi trường chưa có release hợp lệ (EXPERIENCE_NOT_CONFIGURED). */
  configured?: boolean;
  /** Độ trễ giả lập, ms. Test đặt 0. */
  delayMs?: number;
}

export interface MockTransport extends ChatTransport {
  /** Helper để test và demo: đóng phiên theo lệnh học sinh. */
  endConversation(conversationId: string): void;
  /** Helper để test và demo: phiên hết hạn theo đồng hồ server. */
  expireConversation(conversationId: string): void;
}

export function createMockTransport(options: MockTransportOptions = {}): MockTransport {
  const configured = options.configured ?? true;
  const delayMs = options.delayMs ?? 0;
  const conversations = new Map<string, MockConversation>();
  const createReplays = new Map<string, { payload: string; response: RawResponse }>();
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}_${++seq}`;

  const findConversation = (id: string) => conversations.get(id);

  function conversationView(conv: MockConversation) {
    const activity = conv.activity ? activityView(conv, conv.activity) : null;
    return {
      id: conv.id,
      schema_version: 1,
      status: conv.status,
      revision: conv.revision,
      agent_release_id: 'agent_release_demo',
      display_name: conv.activity?.display_name ?? null,
      active_activity: activity,
      created_at: '2026-10-14T03:00:00Z',
      expires_at: '2026-10-14T04:00:00Z',
    };
  }

  function currentQuestion(activity: MockActivity): FixtureQuestion | null {
    if (activity.status !== 'in_progress') return null;
    return FIXTURE_QUESTIONS[activity.answers.length] ?? null;
  }

  function activityView(conv: MockConversation, activity: MockActivity) {
    const question = currentQuestion(activity);
    return {
      id: activity.id,
      conversation_id: conv.id,
      type: 'personality_assessment',
      schema_version: 1,
      status: activity.status,
      revision: activity.revision,
      display_name: activity.display_name,
      progress: { completed: activity.answers.length, total: TOTAL },
      current_question: question
        ? { question_id: question.question_id, title: question.title, options: question.options }
        : null,
      clarification:
        activity.status === 'in_progress' && activity.proposal
          ? {
              proposal_id: activity.proposal.proposal_id,
              question_id: activity.proposal.question_id,
              activity_revision: activity.revision,
              title: 'Bạn có muốn chọn một trong các đáp án này không?',
              candidates: activity.proposal.candidates,
            }
          : null,
      answers: activity.answers.map((a, i) => ({
        answer_id: `ans_${activity.id}_${i + 1}`,
        question_id: a.question_id,
        option_id: a.option_id,
        ordinal: i + 1,
        accepted_activity_revision: activity.revision,
        source: 'option',
        question: questionById(a.question_id),
      })),
      result:
        activity.resultRevision !== null
          ? {
              result_id: `res_${activity.id}`,
              result_revision: activity.resultRevision,
              validity: 'valid',
            }
          : null,
      is_demo: true,
      created_at: '2026-10-14T03:00:00Z',
      expires_at: null,
    };
  }

  function questionById(questionId: string) {
    const q = FIXTURE_QUESTIONS.find((x) => x.question_id === questionId);
    return q ? { question_id: q.question_id, title: q.title, options: q.options } : undefined;
  }

  function textBlock(content: string) {
    return { block_id: nextId('block'), type: 'text', schema_version: 1, content };
  }

  function questionBlock(activity: MockActivity, question: FixtureQuestion) {
    return {
      block_id: nextId('block'),
      type: 'assessment_question',
      schema_version: 1,
      activity_id: activity.id,
      question_id: question.question_id,
      title: question.title,
      options: question.options,
      progress: { completed: activity.answers.length, total: TOTAL },
    };
  }

  function clarificationBlock(activity: MockActivity, proposal: Proposal) {
    return {
      block_id: nextId('block'),
      type: 'assessment_clarification',
      schema_version: 1,
      activity_id: activity.id,
      proposal_id: proposal.proposal_id,
      question_id: proposal.question_id,
      activity_revision: activity.revision,
      title: 'Bạn có muốn chọn một trong các đáp án này không?',
      candidates: proposal.candidates,
      progress: { completed: activity.answers.length, total: TOTAL },
    };
  }

  function cardBlock(activity: MockActivity) {
    return {
      block_id: nextId('block'),
      type: 'personality_card',
      schema_version: 1,
      activity_id: activity.id,
      result_id: `res_${activity.id}`,
      result_revision: activity.resultRevision ?? 1,
      data: DEMO_CARD_DATA,
    };
  }

  /** Hoàn tất khi đủ 6 đáp án: chuyển completed, tạo result và thẻ trong cùng một lần ghi (QT-05, QT-09). */
  function completeIfDone(activity: MockActivity, blocks: unknown[]) {
    if (activity.answers.length === TOTAL) {
      activity.status = 'completed';
      activity.proposal = null;
      activity.resultRevision = (activity.resultRevision ?? 0) + 1;
      blocks.push(cardBlock(activity));
    }
  }

  function turnResponse(conv: MockConversation, blocks: unknown[]): RawResponse {
    return {
      status: 200,
      body: successEnvelope(200, {
        conversation_id: conv.id,
        schema_version: 1,
        revision: conv.revision,
        turn_id: nextId('turn'),
        message_id: nextId('msg'),
        committed_at: '2026-10-14T03:00:00Z',
        activity: conv.activity ? activityView(conv, conv.activity) : null,
        blocks,
      }),
    };
  }

  function commitAnswer(conv: MockConversation, activity: MockActivity, answer: Answer) {
    activity.answers.push(answer);
    activity.proposal = null;
    activity.revision += 1;
    conv.revision += 1;
  }

  function handleCreate(body: Record<string, unknown>): RawResponse {
    if (!configured) {
      return {
        status: 422,
        body: errorEnvelope(422, 'EXPERIENCE_NOT_CONFIGURED', {
          message: 'Hệ thống chưa được cấu hình để bắt đầu trò chuyện.',
        }),
      };
    }
    const key = String(body.idempotency_key ?? '');
    const replay = createReplays.get(key);
    if (replay) return replay.response;

    const conv: MockConversation = {
      id: nextId('conv'),
      revision: 0,
      status: 'active',
      activity: null,
      idempotency: new Map(),
    };
    conversations.set(conv.id, conv);
    const response: RawResponse = {
      status: 201,
      body: successEnvelope(201, {
        conversation: conversationView(conv),
        message_id: nextId('msg'),
        blocks: [textBlock(GREETING_TEXT)],
      }),
    };
    createReplays.set(key, { payload: JSON.stringify(body), response });
    return response;
  }

  function handleRead(conversationId: string): RawResponse {
    const conv = findConversation(conversationId);
    if (!conv) {
      return {
        status: 404,
        body: errorEnvelope(404, 'RESOURCE_NOT_FOUND', { message: 'Không tìm thấy phiên.' }),
      };
    }
    return { status: 200, body: successEnvelope(200, conversationView(conv)) };
  }

  function handleTurn(conversationId: string, body: Record<string, unknown>): RawResponse {
    const conv = findConversation(conversationId);
    if (!conv) {
      return {
        status: 404,
        body: errorEnvelope(404, 'RESOURCE_NOT_FOUND', { message: 'Không tìm thấy phiên.' }),
      };
    }

    // Idempotency trước kiểm revision (SRS 3.5): cùng key + cùng payload trả lại kết quả đã ghi.
    const key = String(body.idempotency_key ?? '');
    const payload = JSON.stringify(body);
    const seen = conv.idempotency.get(key);
    if (seen) {
      if (seen.payload !== payload) {
        return {
          status: 409,
          body: errorEnvelope(409, 'IDEMPOTENCY_KEY_COLLISION', {
            message: 'Khóa idempotency đã được dùng với nội dung khác.',
          }),
        };
      }
      return {
        status: seen.response.status,
        body: withReplayed(seen.response.body),
      };
    }

    if (conv.status === 'ended') {
      return {
        status: 410,
        body: errorEnvelope(410, 'CONVERSATION_ENDED', { message: 'Phiên đã kết thúc.' }),
      };
    }
    if (conv.status === 'expired') {
      return {
        status: 410,
        body: errorEnvelope(410, 'CONVERSATION_EXPIRED', { message: 'Phiên đã hết hạn.' }),
      };
    }

    if (body.expected_revision !== conv.revision) {
      return revisionConflict(conv, Number(body.expected_revision));
    }

    const response = applyTurn(conv, body);
    if (response.status < 300) conv.idempotency.set(key, { payload, response });
    return response;
  }

  function withReplayed(body: unknown): unknown {
    const envelope = body as { meta: Record<string, unknown> };
    return { ...envelope, meta: { ...envelope.meta, replayed: true } };
  }

  function revisionConflict(conv: MockConversation, expected: number): RawResponse {
    return {
      status: 409,
      body: errorEnvelope(409, 'REVISION_CONFLICT', {
        message: 'Trạng thái đã thay đổi, hãy tải lại.',
        retryable: false,
        details: {
          kind: 'revision_conflict',
          expected_revision: expected,
          actual_revision: conv.revision,
          conversation: conversationView(conv),
          activity: conv.activity ? activityView(conv, conv.activity) : null,
        },
      }),
    };
  }

  function invalid(status: number, code: string, message: string): RawResponse {
    return { status, body: errorEnvelope(status, code, { message }) };
  }

  function applyTurn(conv: MockConversation, body: Record<string, unknown>): RawResponse {
    if (body.type === 'message') {
      return applyMessage(conv, body);
    }
    if (body.type === 'interaction') {
      return applyInteraction(conv, body);
    }
    return invalid(400, 'INVALID_REQUEST', 'Loại lượt không hợp lệ.');
  }

  function applyMessage(conv: MockConversation, body: Record<string, unknown>): RawResponse {
    const text = String((body.content as { text?: unknown } | undefined)?.text ?? '').trim();
    if (!text) return invalid(400, 'INVALID_REQUEST', 'Nội dung trống.');

    // Chưa có phiên: tin nhắn đầu tiên mở phiên và hỏi tên (QT-01).
    if (!conv.activity) {
      conv.activity = {
        id: nextId('act'),
        status: 'collecting_name',
        revision: 0,
        display_name: null,
        answers: [],
        proposal: null,
        resultRevision: null,
      };
      conv.revision += 1;
      return turnResponse(conv, [textBlock(NAME_PROMPT_TEXT)]);
    }

    const activity = conv.activity;
    if (activity.status === 'collecting_name') {
      return invalid(422, 'INVALID_INPUT', 'Hãy nhập tên trước khi trả lời.');
    }
    if (activity.status === 'in_progress') {
      // Text không tự thành đáp án: tạo proposal và chờ học sinh xác nhận (QT-07).
      const question = currentQuestion(activity);
      if (!question)
        return invalid(422, 'INVALID_ACTIVITY_TRANSITION', 'Không có câu hỏi đang chờ.');
      activity.proposal = {
        proposal_id: nextId('prop'),
        question_id: question.question_id,
        candidates: question.options.slice(0, 2).map((o) => ({
          id: `cand_${o.id}`,
          option_id: o.id,
          label: o.label,
        })),
      };
      activity.revision += 1;
      conv.revision += 1;
      return turnResponse(conv, [clarificationBlock(activity, activity.proposal)]);
    }

    // completed, ended, expired: trò chuyện chung, không đổi state phiên.
    conv.revision += 1;
    return turnResponse(conv, [textBlock(DEMO_NOTICE_TEXT)]);
  }

  function applyInteraction(conv: MockConversation, body: Record<string, unknown>): RawResponse {
    const activity = conv.activity;
    if (!activity || body.activity_id !== activity.id) {
      return invalid(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy hoạt động.');
    }
    const payload = (body.payload ?? {}) as Record<string, string>;

    switch (body.action) {
      case 'set_name':
        return applySetName(conv, activity, payload);
      case 'submit_answer':
        return applySubmitAnswer(conv, activity, payload.question_id, payload.option_id);
      case 'confirm_answer':
        return applyConfirm(conv, activity, payload);
      case 'edit_answer':
        return applyEdit(conv, activity, payload.question_id, payload.option_id);
      default:
        return invalid(400, 'INVALID_REQUEST', 'Hành động không hợp lệ.');
    }
  }

  function applySetName(
    conv: MockConversation,
    activity: MockActivity,
    payload: Record<string, string>,
  ): RawResponse {
    if (activity.status !== 'collecting_name') {
      return invalid(422, 'INVALID_ACTIVITY_TRANSITION', 'Phiên không ở bước nhập tên.');
    }
    const parsed = displayNameSchema.safeParse(payload.display_name ?? '');
    if (!parsed.success)
      return invalid(422, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? 'Tên không hợp lệ.');

    activity.display_name = parsed.data;
    activity.status = 'in_progress';
    activity.revision += 1;
    conv.revision += 1;
    return turnResponse(conv, [questionBlock(activity, FIXTURE_QUESTIONS[0]!)]);
  }

  function applySubmitAnswer(
    conv: MockConversation,
    activity: MockActivity,
    questionId: string | undefined,
    optionId: string | undefined,
  ): RawResponse {
    if (activity.status !== 'in_progress') {
      return invalid(422, 'INVALID_ACTIVITY_TRANSITION', 'Phiên không nhận đáp án lúc này.');
    }
    const question = currentQuestion(activity);
    if (!question || question.question_id !== questionId) {
      return invalid(422, 'INVALID_QUESTION', 'Câu hỏi không phải câu hiện tại.');
    }
    if (!question.options.some((o) => o.id === optionId)) {
      return invalid(422, 'INVALID_OPTION', 'Lựa chọn không thuộc câu hỏi.');
    }

    commitAnswer(conv, activity, { question_id: question.question_id, option_id: optionId! });
    const blocks: unknown[] = [];
    if (activity.answers.length < TOTAL) {
      blocks.push(questionBlock(activity, FIXTURE_QUESTIONS[activity.answers.length]!));
    }
    completeIfDone(activity, blocks);
    return turnResponse(conv, blocks);
  }

  function applyConfirm(
    conv: MockConversation,
    activity: MockActivity,
    payload: Record<string, string>,
  ): RawResponse {
    if (activity.status !== 'in_progress' || !activity.proposal) {
      return invalid(409, 'STALE_CLARIFICATION', 'Đề xuất này không còn hiệu lực.');
    }
    if (activity.proposal.proposal_id !== payload.proposal_id) {
      return invalid(409, 'STALE_CLARIFICATION', 'Đề xuất này không còn hiệu lực.');
    }
    const candidate = activity.proposal.candidates.find((c) => c.id === payload.candidate_id);
    if (!candidate) return invalid(422, 'INVALID_OPTION', 'Lựa chọn không thuộc đề xuất.');

    commitAnswer(conv, activity, {
      question_id: activity.proposal.question_id,
      option_id: candidate.option_id,
    });
    const blocks: unknown[] = [];
    if (activity.answers.length < TOTAL) {
      blocks.push(questionBlock(activity, FIXTURE_QUESTIONS[activity.answers.length]!));
    }
    completeIfDone(activity, blocks);
    return turnResponse(conv, blocks);
  }

  function applyEdit(
    conv: MockConversation,
    activity: MockActivity,
    questionId: string | undefined,
    optionId: string | undefined,
  ): RawResponse {
    if (activity.status !== 'in_progress' && activity.status !== 'completed') {
      return invalid(422, 'INVALID_ACTIVITY_TRANSITION', 'Phiên không cho sửa đáp án lúc này.');
    }
    const index = FIXTURE_QUESTIONS.findIndex((q) => q.question_id === questionId);
    if (index < 0 || index >= activity.answers.length) {
      return invalid(422, 'INVALID_QUESTION', 'Chỉ sửa được câu đã trả lời.');
    }
    const question = FIXTURE_QUESTIONS[index]!;
    if (!question.options.some((o) => o.id === optionId)) {
      return invalid(422, 'INVALID_OPTION', 'Lựa chọn không thuộc câu hỏi.');
    }

    // Sửa câu i: giữ câu 1..i-1, đặt đáp án mới, bỏ các câu sau (QT-08).
    activity.answers = [
      ...activity.answers.slice(0, index),
      { question_id: question.question_id, option_id: optionId! },
    ];
    activity.status = 'in_progress';
    activity.proposal = null;
    activity.resultRevision = null;
    activity.revision += 1;
    conv.revision += 1;

    const blocks: unknown[] = [];
    if (activity.answers.length < TOTAL) {
      blocks.push(questionBlock(activity, FIXTURE_QUESTIONS[activity.answers.length]!));
    }
    completeIfDone(activity, blocks);
    return turnResponse(conv, blocks);
  }

  async function request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<RawResponse> {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const payload = (body ?? {}) as Record<string, unknown>;

    if (method === 'POST' && path === 'conversations') return handleCreate(payload);

    const turnMatch = /^conversations\/([^/]+)\/turns$/.exec(path);
    if (method === 'POST' && turnMatch) return handleTurn(turnMatch[1]!, payload);

    const readMatch = /^conversations\/([^/]+)$/.exec(path);
    if (method === 'GET' && readMatch) return handleRead(readMatch[1]!);

    return {
      status: 404,
      body: errorEnvelope(404, 'RESOURCE_NOT_FOUND', { message: 'Không tìm thấy.' }),
    };
  }

  return {
    request,
    endConversation(conversationId) {
      const conv = findConversation(conversationId);
      if (conv) conv.status = 'ended';
    },
    expireConversation(conversationId) {
      const conv = findConversation(conversationId);
      if (conv) conv.status = 'expired';
    },
  };
}
