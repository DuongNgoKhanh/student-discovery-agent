import { ApiError } from './errors';
import { mapErrorMessage } from './error-map';

/**
 * Envelope chuẩn của backend. Viết phòng thủ: chấp nhận cả `error` (guideline)
 * lẫn `errors` (error_codes.md). Xác minh shape thật ở
 * `sda-backend/app/modules/common/utils/response.py` khi tích hợp.
 */
interface ErrorPayload {
  code: string;
  message?: string;
  details?: unknown;
  retryable?: boolean;
}

interface Envelope<T> {
  success: boolean;
  data: T | null;
  error?: ErrorPayload | null;
  errors?: ErrorPayload | null;
  message?: string;
}

/**
 * Parse envelope backend:
 * - success=true  → trả `data`.
 * - success=false → ném `ApiError` (kể cả HTTP 200 với lỗi nghiệp vụ).
 */
export async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json()) as Envelope<T>;
  if (body.success) return body.data as T;

  const err = body.error ?? body.errors ?? undefined;
  const code = err?.code ?? `HTTP_${res.status}`;
  throw new ApiError({
    code,
    message: err?.message ?? body.message ?? mapErrorMessage(code),
    details: err?.details,
    retryable: err?.retryable,
    httpStatus: res.status,
  });
}
