/**
 * Fixture dùng chung cho mock transport và test. Dữ liệu là demo, không phải kết quả chuyên môn
 * (SRS FR-UI-04: nội dung demo phải có nhãn demo). Thay bằng dữ liệu release thật khi backend sẵn sàng.
 */

export interface FixtureQuestion {
  question_id: string;
  title: string;
  options: { id: string; label: string }[];
}

/** Sáu câu theo thứ tự cố định, dùng cho mock. Câu 1–3 cơ bản, câu 4–6 do selector chọn ở backend. */
export const FIXTURE_QUESTIONS: FixtureQuestion[] = [
  {
    question_id: 'q1',
    title: 'Trong một buổi học nhóm, bạn thường làm gì?',
    options: [
      { id: 'q1_a', label: 'Đứng ra điều phối và chia việc' },
      { id: 'q1_b', label: 'Tìm ý tưởng mới và đề xuất cách làm' },
      { id: 'q1_c', label: 'Ghi chép và kiểm tra chi tiết' },
    ],
  },
  {
    question_id: 'q2',
    title: 'Khi gặp một bài toán khó, bạn sẽ?',
    options: [
      { id: 'q2_a', label: 'Thử nhiều cách cho đến khi ra' },
      { id: 'q2_b', label: 'Hỏi bạn bè hoặc thầy cô' },
      { id: 'q2_c', label: 'Tìm tài liệu rồi làm theo từng bước' },
    ],
  },
  {
    question_id: 'q3',
    title: 'Bạn thích hoạt động nào hơn vào cuối tuần?',
    options: [
      { id: 'q3_a', label: 'Tham gia câu lạc bộ hoặc hoạt động tình nguyện' },
      { id: 'q3_b', label: 'Tự làm dự án hoặc sáng tác' },
      { id: 'q3_c', label: 'Đọc sách hoặc tìm hiểu chủ đề mình quan tâm' },
    ],
  },
  {
    question_id: 'q4',
    title: 'Bạn muốn công việc tương lai có tính chất nào?',
    options: [
      { id: 'q4_a', label: 'Làm việc với người khác' },
      { id: 'q4_b', label: 'Làm việc với ý tưởng và công nghệ' },
      { id: 'q4_c', label: 'Làm việc với số liệu và quy trình' },
    ],
  },
  {
    question_id: 'q5',
    title: 'Khi có thay đổi bất ngờ, bạn phản ứng thế nào?',
    options: [
      { id: 'q5_a', label: 'Thích nghi nhanh và xem đó là cơ hội' },
      { id: 'q5_b', label: 'Cần thời gian để suy nghĩ trước' },
      { id: 'q5_c', label: 'Muốn có kế hoạch rõ ràng trước khi làm' },
    ],
  },
  {
    question_id: 'q6',
    title: 'Điều gì khiến bạn cảm thấy có động lực nhất?',
    options: [
      { id: 'q6_a', label: 'Được người khác ghi nhận và cần đến' },
      { id: 'q6_b', label: 'Được tự do sáng tạo' },
      { id: 'q6_c', label: 'Thấy kết quả cụ thể và đo đếm được' },
    ],
  },
];

export const GREETING_TEXT =
  'Chào bạn! Mình là trợ lý giúp bạn khám phá hướng đi phù hợp. Bạn bắt đầu nhé?';
export const NAME_PROMPT_TEXT = 'Mình gọi bạn là gì nhỉ?';
export const DEMO_NOTICE_TEXT = 'Đây là bản demo, nội dung không phải kết quả tư vấn chính thức.';

export const DEMO_CARD_DATA = {
  display_name: 'Bạn',
  house: {
    house_id: 'house_demo_a',
    name: 'Hệ Demo A',
    theme_ref: 'theme_demo_a',
    mascot_ref: 'mascot_demo_a',
  },
  strengths: ['Điều phối tốt', 'Lắng nghe'],
  tendencies: ['Thích làm việc theo nhóm'],
  career_groups: ['Nhóm nghề demo'],
  quote: 'Nội dung demo để kiểm tra giao diện thẻ.',
  is_demo: true,
};

/** Lỗi theo envelope của backend (common.yaml, ErrorEnvelope). */
export function errorEnvelope(
  status: number,
  code: string,
  options: { message?: string; retryable?: boolean; details?: Record<string, unknown> | null } = {},
) {
  return {
    status,
    success: false,
    message: null,
    data: null,
    error: {
      code,
      message: options.message ?? code,
      retryable: options.retryable ?? false,
      details: options.details ?? null,
    },
    meta: fixtureMeta(),
  };
}

export function successEnvelope(status: number, data: unknown) {
  return { status, success: true, message: null, data, error: null, meta: fixtureMeta() };
}

export function fixtureMeta() {
  return {
    request_id: 'req_fixture',
    trace_id: 'trace_fixture',
    timestamp: '2026-10-14T03:00:00Z',
  };
}
