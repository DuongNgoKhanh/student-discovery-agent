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
  throw new ApiError({
    code: err.code,
    message: mapErrorMessage(err.code),
    details: err.details ?? undefined,
    retryable: err.retryable,
    httpStatus,
  });
}
