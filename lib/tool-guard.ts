import { FatalError, getStepMetadata, RetryableError } from "workflow";
import { HookConflictError } from "workflow/errors";
import { ApiRequestError } from "@/lib/api";

const MAX_DETAIL_CHARS = 160;

/**
 * Maps every failure to a safe message. Network errors, 429 and 5xx retry
 * with backoff. Client errors and bugs fail at once, because a retry gives
 * the same result.
 */
export async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    if (FatalError.is(cause) || RetryableError.is(cause) || HookConflictError.is(cause)) throw cause;
    if (cause instanceof ApiRequestError) throw apiFailure(cause);
    console.error("[step] unexpected failure:", cause instanceof Error ? cause.message : cause);
    throw new FatalError("The step failed unexpectedly.");
  }
}

function apiFailure(err: ApiRequestError): Error {
  if (err.status === 0) {
    return new RetryableError("The store API is not reachable. Try again later.", backoff());
  }
  if (err.status === 429) {
    return new RetryableError("The store API is busy. Try again later.", { retryAfter: "30s" });
  }
  const label = `The store API failed (${err.code ?? err.status})`;
  if (err.status >= 500) return new RetryableError(`${label}.`, backoff());

  // The API's validation text helps the model fix its input.
  const detail = err.safeDetail?.replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL_CHARS);
  return new FatalError(detail ? `${label}: ${detail}` : `${label}.`);
}

/** 1 s, 4 s, 9 s for attempts 1, 2, 3. */
export function backoff() {
  const { attempt } = getStepMetadata();
  return { retryAfter: attempt ** 2 * 1000 };
}
