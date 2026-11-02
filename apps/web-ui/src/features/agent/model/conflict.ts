import { ApiError } from '@/lib/api/errors';

export const CONFLICT_MESSAGE = 'Cấu hình đã thay đổi, đã tải lại trạng thái mới — kiểm tra rồi thử lại.';
export const NO_CHANGES_MESSAGE = 'Bản nháp trùng với phiên bản đang dùng, không có gì để phát hành.';

/** Returns a user message when the error is a 409 that a state reload resolves; null otherwise. */
export function conflictMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'CONFLICT_REVISION') return CONFLICT_MESSAGE;
  if (error.code === 'CONFLICT_INVALID_STATE') {
    return (error.details as { kind?: string } | undefined)?.kind === 'no_changes' ? NO_CHANGES_MESSAGE : CONFLICT_MESSAGE;
  }
  return null;
}
