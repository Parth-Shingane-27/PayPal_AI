/**
 * AppError is the one error type services throw on purpose. Its message is
 * written for the end user (and the model): the agent runtime turns it into an
 * `is_error` tool result, and API routes turn it into a JSON error response.
 * Anything else is unexpected: callers log it and show a generic message.
 */
type AppErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "INVALID_INPUT"
  | "CONFLICT"
  | "INSUFFICIENT_FUNDS"
  | "NOT_REFUNDABLE"
  | "PAYMENT_DECLINED"
  | "UPSTREAM_ERROR"
  | "RATE_LIMITED";

const HTTP_STATUS: Record<AppErrorCode, number> = {
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNAUTHENTICATED: 401,
  INVALID_INPUT: 400,
  CONFLICT: 409,
  INSUFFICIENT_FUNDS: 422,
  NOT_REFUNDABLE: 422,
  PAYMENT_DECLINED: 402,
  UPSTREAM_ERROR: 502,
  RATE_LIMITED: 429,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: AppErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
}

/** The same "not found" for missing rows and other tenants' rows. */
export function notFound(what: string): AppError {
  return new AppError("NOT_FOUND", `${what} not found.`);
}
