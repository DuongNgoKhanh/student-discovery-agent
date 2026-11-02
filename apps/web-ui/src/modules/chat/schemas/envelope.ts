import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { mapErrorMessage } from '@/lib/api/error-map';

/**
 * Envelope chat. Nguồn: docs/openapi/schemas/common.yaml (SuccessEnvelope, ErrorEnvelope).
 * Quyết định thành công/lỗi dựa vào `success`, không dựa vào HTTP status (FR-UI-01).
 */

export const errorDetailSchema = z
  .object({
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.unknown()).nullable().optional(),
  })
  .passthrough();

export const chatMetaSchema = z
  .object({
    request_id: z.string().min(1),
    trace_id: z.string().min(1),
    timestamp: z.string(),
    replayed: z.boolean().optional(),
  })
  .passthrough();

export function envelopeSchema<T extends z.ZodTypeAny>(data: T) {
  return z.discriminatedUnion('success', [
    z
      .object({
        status: z.number().int(),
        success: z.literal(true),
        message: z.string().nullable().optional(),
        data,
        error: z.null().optional(),
        meta: chatMetaSchema,
      })
      .passthrough(),
    z
      .object({
        status: z.number().int(),
        success: z.literal(false),
        message: z.string().nullable().optional(),
        data: z.null(),
        error: errorDetailSchema,
        meta: chatMetaSchema,
      })
      .passthrough(),
  ]);
}

/** Code do client tự tạo khi response không đúng envelope; không nằm trong contract backend. */
export const CLIENT_INVALID_ENVELOPE = 'CLIENT_INVALID_ENVELOPE';

/**
 * Runtime trả mã theo registry chuẩn (contracts/error-codes.json); UI chat vẫn xử lý theo tên cũ trong
 * docs/openapi/schemas/common.yaml. Chuẩn hoá một chỗ ở đây thay vì rải điều kiện khắp hook/component.
 */
const LEGACY_CHAT_CODES: Record<string, string> = {
  CONFLICT_REVISION: 'REVISION_CONFLICT',
  CONFLICT_IDEMPOTENCY_KEY: 'IDEMPOTENCY_KEY_COLLISION',
  CONFLICT_STALE_CLARIFICATION: 'STALE_CLARIFICATION',
  CONFLICT_STALE_RESULT_REVISION: 'STALE_RESULT_REVISION',
  CONFLICT_ACTIVE_RELEASE: 'ACTIVE_RELEASE_CONFLICT',
  RES_CONVERSATION_ENDED: 'CONVERSATION_ENDED',
  RES_CONVERSATION_EXPIRED: 'CONVERSATION_EXPIRED',
  RES_EXPERIENCE_NOT_CONFIGURED: 'EXPERIENCE_NOT_CONFIGURED',
  RES_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  AUTH_TOKEN_MISSING: 'AUTH_REQUIRED',
  AUTH_TOKEN_INVALID: 'AUTH_REQUIRED',
  AUTH_CALLER_CONTEXT_INVALID: 'AUTH_REQUIRED',
  AUTHZ_FORBIDDEN: 'FORBIDDEN',
  VAL_INVALID_REQUEST: 'INVALID_REQUEST',
  VAL_INVALID_INPUT: 'INVALID_INPUT',
  VAL_INVALID_ACTIVITY_TRANSITION: 'INVALID_ACTIVITY_TRANSITION',
  VAL_INVALID_QUESTION: 'INVALID_QUESTION',
  VAL_INVALID_OPTION: 'INVALID_OPTION',
  VAL_PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  SYS_RATE_LIMITED: 'RATE_LIMITED',
  SYS_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  SYS_REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  SYS_INTERNAL_ERROR: 'INTERNAL_ERROR',
};

export function chatErrorCode(code: string): string {
  return LEGACY_CHAT_CODES[code] ?? code;
}

/**
 * Trả `data` đã validate, hoặc ném `ApiError` với đúng code/details từ server.
 * Ném `ApiError` cả khi envelope sai shape để UI không render dữ liệu hỏng.
 */
export function unwrapChatEnvelope<T extends z.ZodTypeAny>(
  raw: unknown,
  httpStatus: number,
  dataSchema: T,
): z.infer<T> {
  const parsed = envelopeSchema(dataSchema).safeParse(raw);
  if (!parsed.success) {
    throw new ApiError({
      code: CLIENT_INVALID_ENVELOPE,
      message: mapErrorMessage(CLIENT_INVALID_ENVELOPE),
      retryable: false,
      httpStatus,
    });
  }

  const body = parsed.data;
  if (body.success) return body.data as z.infer<T>;

  const err = body.error;
  if (!err) {
    throw new ApiError({
      code: CLIENT_INVALID_ENVELOPE,
      message: mapErrorMessage(CLIENT_INVALID_ENVELOPE),
      retryable: false,
      httpStatus,
    });
  }
  const code = chatErrorCode(err.code);
  throw new ApiError({
    code,
    message: mapErrorMessage(code),
    details: err.details ?? undefined,
    retryable: err.retryable,
    httpStatus,
  });
}
