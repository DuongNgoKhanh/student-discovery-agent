/**
 * Lỗi chuẩn hoá khi gọi API. Bọc lại `error` trong envelope của backend
 * (cả lỗi nghiệp vụ HTTP 200 lẫn lỗi kỹ thuật 4xx/5xx).
 */
export class ApiError extends Error {
  code: string;
  details?: unknown;
  retryable: boolean;
  httpStatus: number;

  constructor(params: {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
    httpStatus: number;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.code = params.code;
    this.details = params.details;
    this.retryable = params.retryable ?? false;
    this.httpStatus = params.httpStatus;
  }
}
