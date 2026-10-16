/**
 * Map error code của backend sang thông điệp hiển thị (tiếng Việt).
 * Seed từ `sda-backend/docs/openapi/error_codes.md`. Bổ sung code cụ thể khi BE thêm.
 */
const MESSAGES: Record<string, string> = {
  AUTH_401: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
  AUTHZ_403: 'Bạn không có quyền thực hiện thao tác này.',
  RES_404: 'Không tìm thấy dữ liệu yêu cầu.',
  VAL_400: 'Dữ liệu nhập không hợp lệ.',
  VAL_422: 'Dữ liệu nhập không hợp lệ.',
  SYS_500: 'Hệ thống đang gặp sự cố, vui lòng thử lại sau.',
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
