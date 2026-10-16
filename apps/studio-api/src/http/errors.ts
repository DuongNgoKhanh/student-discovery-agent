
/** Expected, client-visible error. Anything else is reported as INTERNAL_ERROR. */
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
