
import { canonicalErrorCode } from '@/generated/error-codes';

/** Expected service error. HTTP projection canonicalizes registered historical names. */
export class ProductError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean = false,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ProductError';
  }
}

/** Shared by top-level and per-item HTTP envelopes; service identities stay unchanged. */
export function transportError(error: ProductError) {
  const registered = canonicalErrorCode(error.code);
  const e = registered ? error : new ProductError(500, 'SYS_INTERNAL_ERROR', 'Internal server error');
  const code = registered ?? 'SYS_INTERNAL_ERROR';
  const details = e.details == null ? null : typeof e.details === 'object' && !Array.isArray(e.details)
    ? e.details as Record<string, unknown> : { value: e.details };
  return {
    status: e.status,
    error: { code, ...(code !== e.code ? { legacy_code: e.code } : {}), message: e.message, retryable: e.retryable, details },
  };
}
