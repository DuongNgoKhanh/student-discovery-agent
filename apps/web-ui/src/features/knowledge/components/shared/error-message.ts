import { mapErrorMessage } from '@/lib/api/error-map';
import { ApiError } from '@/lib/api/errors';

export const STATUS_MESSAGES: Partial<Record<number, string>> = {
  409: 'Dữ liệu đã thay đổi hoặc bị trùng, hãy tải lại rồi thử lại.',
  413: 'Nội dung quá lớn, hãy chia nhỏ rồi thử lại.',
  422: 'Dữ liệu chưa hợp lệ, hãy kiểm tra lại các trường.',
  503: 'Dịch vụ tạm thời không sẵn sàng, hãy thử lại sau ít phút.',
};

// Some failures share a status with transient ones but will not pass on retry; details.kind tells them apart.
const KIND_MESSAGES: Record<string, string> = {
  misconfigured: 'Studio và runtime chưa được cấu hình khớp nhau (khoá ký hoặc quyền). Thử lại sẽ không được — hãy báo quản trị hệ thống.',
  runtime_rejected: 'Runtime từ chối yêu cầu kiểm tra cấu hình. Thử lại sẽ không được — hãy báo quản trị hệ thống.',
};

// Server messages are English unless a module localised them (e.g. import errors); prefer the localised ones.
const isLocalised = (message: string) => /[^\x00-\x7F]/.test(message);

/** One Vietnamese sentence for any error; `overrides` lets a screen say something more specific per HTTP status. */
export function errorMessage(error: unknown, overrides: Partial<Record<number, string>> = {}): string {
  if (error instanceof ApiError) {
    const kind = (error.details as { kind?: unknown } | undefined)?.kind;
    return overrides[error.httpStatus]
      ?? (typeof kind === 'string' ? KIND_MESSAGES[kind] : undefined)
      ?? (error.message && isLocalised(error.message) ? error.message : undefined)
      ?? STATUS_MESSAGES[error.httpStatus]
      ?? mapErrorMessage(error.code);
  }
  return error instanceof Error && error.message ? error.message : 'Đã có lỗi xảy ra.';
}
