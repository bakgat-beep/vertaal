// What kind of failure a translation provider reported, because the right
// reaction differs:
//   - "permanent": trying the same request again can never work until the
//     person changes something (a wrong or missing API key, no model chosen,
//     a used-up quota, a bad address). Retrying just wastes time, and flagging
//     every string for review would blame the strings for a settings problem.
//   - "transient": might work next time (a slow reply, a dropped connection, a
//     busy server, a rate limit). Worth retrying.
// Anything that is not a ProviderError is treated as transient.
export type ProviderErrorKind = "permanent" | "transient";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  constructor(message: string, kind: ProviderErrorKind, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = status;
  }
}

// 400 bad request, 401/403 not allowed, 402 payment needed, 404 not found,
// 405, 413 too large, 422 unprocessable, 456 DeepL "quota exceeded". Note that
// 408, 429 (rate limit) and 5xx are deliberately NOT here: those can pass.
const PERMANENT_STATUSES = new Set([400, 401, 402, 403, 404, 405, 413, 422, 456]);

export function responseError(label: string, status: number, detail: string): ProviderError {
  return new ProviderError(
    `${label} request failed: ${status} ${detail}`.trim(),
    PERMANENT_STATUSES.has(status) ? "permanent" : "transient",
    status
  );
}

export function isPermanentError(err: unknown): boolean {
  return err instanceof ProviderError && err.kind === "permanent";
}