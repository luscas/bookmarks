/**
 * Error thrown whenever an AI provider cannot produce a usable result: a
 * network/HTTP failure, a body we cannot parse, or a response missing the
 * fields we require. Callers can inspect `status` to distinguish transport
 * failures from malformed payloads.
 */
export class AiProviderError extends Error {
  /** HTTP status code, when the failure originated from a response. */
  readonly status?: number;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message);
    this.name = "AiProviderError";
    this.status = options.status;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
