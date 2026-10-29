/**
 * Map error code của backend sang thông điệp hiển thị (tiếng Việt).
 * Seed từ `contracts/error_codes.md`. Bổ sung code cụ thể khi BE thêm.
 */
const MESSAGES: Record<string, string> = {
  AUTH_401: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
  AUTH_INVALID_CREDENTIALS: 'Tên đăng nhập hoặc mật khẩu không đúng.',
  AUTHZ_403: 'Bạn không có quyền thực hiện thao tác này.',
  RES_404: 'Không tìm thấy dữ liệu yêu cầu.',
  VAL_400: 'Dữ liệu nhập không hợp lệ.',
  VAL_422: 'Dữ liệu nhập không hợp lệ.',
  SYS_500: 'Hệ thống đang gặp sự cố, vui lòng thử lại sau.',
  // Mã chat theo docs/openapi/schemas/common.yaml (không theo PREFIX_CODE).
  AUTH_REQUIRED: 'Phiên trò chuyện không hợp lệ, vui lòng tải lại trang.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  RESOURCE_NOT_FOUND: 'Không tìm thấy phiên trò chuyện.',
  INVALID_REQUEST: 'Yêu cầu không hợp lệ, vui lòng thử lại.',
  INVALID_INPUT: 'Dữ liệu nhập không hợp lệ.',
  INVALID_ACTIVITY_TRANSITION: 'Thao tác này không thực hiện được ở bước hiện tại.',
  INVALID_QUESTION: 'Câu hỏi đã thay đổi, vui lòng thử lại.',
  INVALID_OPTION: 'Lựa chọn không hợp lệ, vui lòng chọn lại.',
  REVISION_CONFLICT: 'Nội dung vừa được cập nhật, đang tải lại.',
  IDEMPOTENCY_KEY_COLLISION: 'Thao tác bị trùng, vui lòng tải lại trang.',
  STALE_CLARIFICATION: 'Đề xuất này đã cũ, vui lòng chọn lại.',
  STALE_RESULT_REVISION: 'Kết quả đã thay đổi, đang tải lại.',
  CONVERSATION_ENDED: 'Phiên trò chuyện đã kết thúc. Bạn có thể bắt đầu phiên mới.',
  CONVERSATION_EXPIRED: 'Phiên trò chuyện đã hết hạn. Bạn có thể bắt đầu phiên mới.',
  PAYLOAD_TOO_LARGE: 'Nội dung quá dài, vui lòng rút gọn.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh, vui lòng đợi một chút.',
  EXPERIENCE_NOT_CONFIGURED: 'Hệ thống chưa được cấu hình để bắt đầu trò chuyện.',
  ACTIVE_RELEASE_CONFLICT: 'Hệ thống chưa được cấu hình để bắt đầu trò chuyện.',
  SERVICE_UNAVAILABLE: 'Dịch vụ tạm thời không khả dụng, vui lòng thử lại sau.',
  REQUEST_TIMEOUT: 'Yêu cầu quá thời gian, vui lòng thử lại.',
  INTERNAL_ERROR: 'Hệ thống đang gặp sự cố, vui lòng thử lại sau.',
  CLIENT_INVALID_ENVELOPE: 'Phản hồi từ máy chủ không đúng định dạng.',
  CONFLICT_TURN_IN_PROGRESS: 'Trợ lý vẫn đang trả lời lượt trước, vui lòng đợi một chút.',
  SYS_ENGINE_FAILURE: 'Không xử lý được bài đánh giá lúc này, vui lòng thử lại.',
  SYS_TURN_ABANDONED: 'Lượt trả lời bị gián đoạn, vui lòng gửi lại.',
  VAL_INCOMPATIBLE_SCHEMA: 'Phiên bản giao diện chưa tương thích với cấu hình hiện tại.',
  VAL_INCOMPATIBLE_RELEASE: 'Phiên bản giao diện chưa tương thích với cấu hình hiện tại.',
};

/** Fallback theo prefix module khi không có message cụ thể. */
const PREFIX_FALLBACK: Record<string, string> = {
  AUTH: 'Lỗi xác thực.',
  AUTHZ: 'Không đủ quyền truy cập.',
  RES: 'Không tìm thấy tài nguyên.',
  VAL: 'Dữ liệu không hợp lệ.',
  REQ: 'Yêu cầu không thực hiện được.',
  DB: 'Lỗi dữ liệu.',
  EXT: 'Lỗi dịch vụ bên ngoài.',
  SYS: 'Lỗi hệ thống.',
};

export function mapErrorMessage(code: string): string {
  if (MESSAGES[code]) return MESSAGES[code];
  const prefix = code.split('_')[0] ?? '';
  return PREFIX_FALLBACK[prefix] ?? 'Đã có lỗi xảy ra.';
}
